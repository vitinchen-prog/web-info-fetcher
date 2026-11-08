import { canonicalUrl, normalizeHeadline } from "./history-store.js";

export function supportedSummary(article) {
  const evidence = article.summaryEvidence;
  const summary = typeof article.summary === "string" ? article.summary.trim() : "";
  if (!summary || !evidence || !["paragraph", "title-attribute"].includes(evidence.kind) || typeof evidence.value !== "string") return "";
  const source = evidence.value.trim();
  return source === summary || (summary.endsWith("…") && source.startsWith(summary.slice(0, -1).trimEnd())) ? summary : "";
}

function evidenceAnalysis(event) {
  const claims = new Map();
  const articles = (event.articles || []).filter((article) => canonicalUrl(article.url));
  for (const article of articles) {
    for (const value of [article.title, supportedSummary(article)]) {
      if (typeof value !== "string" || !value.trim()) continue;
      const text = value.trim();
      if (!claims.has(text)) claims.set(text, new Set());
      claims.get(text).add(article.url);
    }
  }
  const observations = [...claims].map(([text, urls]) => ({ text, sourceUrls: [...urls] }));
  const limitations = ["观察为采集到的来源表述，不等于独立事实核验；多个链接也可能引用同一原始消息。"];
  const summaries = articles.filter((article) => supportedSummary(article));
  if (articles.some((article) => article.summary && !supportedSummary(article))) limitations.push("无匹配出处的摘要已排除，不作为观察或推论依据。");
  if (!observations.length) limitations.push("缺少可引用的文章证据，不能形成实质分析。");
  else if (!summaries.length) limitations.push("目前只有标题证据，缺少正文、测试条件和适用范围。");
  else limitations.push("目前仅有标题和采集摘要，未核验完整正文、指标口径或实际使用结果。");
  const { implication, implicationEvidence } = conditionalImplication(observations);
  limitations.push("条件性解读仅提供针对当前证据的核验方向，不替代完整正文分析或业务评估。");
  return { observations, implication, implicationEvidence, limitations };
}

// These are explicit conditional review questions, not claims about real-world impact.
const GUIDANCE = [
  {
    keywords: ["api", "pricing", "price", "prices", "cost", "costs", "定价", "计费", "价格", "降价", "涨价", "费用"],
    implication: "如果来源所述 API 或定价信息适用于你的实际用量，先对照计费单位、配额与限流规则，再决定预算或接入调整；现有证据不足以量化成本影响。",
  },
  {
    keywords: ["search", "seo", "geo", "搜索", "检索", "分发"],
    implication: "如果来源所述搜索或分发信息涉及你的获客渠道，应对照实际上线范围并记录引用、可见度和引荐流量；不能仅凭公告认定流量会上升或下降。",
  },
  {
    keywords: ["model", "models", "gpt", "claude", "gemini", "llama", "模型"],
    implication: "若来源所述模型能力与你的任务相关，应使用实际工作负载核对基准条件、失败案例和可用范围，再决定是否迁移；当前来源表述不构成性能提升的独立证明。",
  },
];

function conditionalImplication(observations) {
  for (const rule of GUIDANCE) {
    const terms = new Set(), sourceUrls = new Set();
    for (const observation of observations) {
      const text = normalizeHeadline(observation.text);
      for (const keyword of rule.keywords) {
        const matches = /[\u3400-\u9fff]/.test(keyword) ? text.includes(keyword) : ` ${text} `.includes(` ${keyword} `);
        if (matches) {
          terms.add(keyword);
          for (const url of observation.sourceUrls) sourceUrls.add(url);
        }
      }
    }
    if (terms.size) return { implication: rule.implication, implicationEvidence: { terms: [...terms], sourceUrls: [...sourceUrls] } };
  }
  return { implication: "现有证据不足以提出具体业务影响判断，暂不推导行业趋势或行动收益。", implicationEvidence: { terms: [], sourceUrls: [] } };
}

// Local deterministic mode deliberately makes no model/network call and incurs no API spend.
export function analyzeEvents(events, { policy = {}, env = process.env } = {}) {
  const requested = policy.analysis?.mode ?? "evidence-only";
  const warnings = [];
  if (requested === "llm") {
    warnings.push(env.OPENAI_API_KEY
      ? "LLM 分析接口尚未实现（unsupported）；已降级为 evidence-only，未调用付费 API。"
      : "未配置 LLM API key，且此版本尚未实现 LLM 分析；已降级为 evidence-only，未调用付费 API。");
  } else if (requested !== "evidence-only") {
    warnings.push(`不支持分析模式 ${String(requested)}，已降级为 evidence-only。`);
  }
  return { events: events.map((event) => ({ ...event, analysis: evidenceAnalysis(event) })), warnings, mode: "evidence-only" };
}
