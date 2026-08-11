import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadLatestBrowserCollection } from "./lib/collection-store.js";
import { articlesFromLinks } from "./lib/extract-articles.js";
import { fetchPageInfo } from "./lib/fetch-page-info.js";
import { citation, formatDateForFilename, formatDateLabel, getCliArg, getWeekRange, isWithinWeek } from "./lib/report-utils.js";
import { getArticleRules } from "./lib/source-rules.js";

const sources = JSON.parse(await readFile(new URL("../config/sources.json", import.meta.url), "utf8"));
const issue = getCliArg("issue", "1");
const now = new Date();
const week = getWeekRange(now);
const fileDate = formatDateForFilename(now);
const outputDir = path.resolve("reports");
const outputFile = path.join(outputDir, `weekly_ai_report_issue_${issue}_mon_${fileDate}.md`);

// Prefer content gathered by the logged-in browser collector when it is available.
const browserCollection = await loadLatestBrowserCollection();

function findBrowserData(source) {
  return browserCollection.byUrl.get(source.url) || browserCollection.byName.get(source.name) || null;
}

function fromBrowserData(source, index, collected) {
  const rules = getArticleRules(source);
  // Newer collections store extracted articles; older ones only have links,
  // so derive articles from the links in that case.
  const articles = collected.articles && collected.articles.length > 0
    ? collected.articles
    : articlesFromLinks(collected.links || [], rules);

  return {
    ...source,
    index,
    status: "browser-collected",
    title: collected.title || source.name,
    description: collected.description || (collected.text ? collected.text.slice(0, 200) : ""),
    links: collected.links || [],
    articles
  };
}

async function collectSource(source, index) {
  const collected = findBrowserData(source);

  if (collected && collected.status === "ok") {
    return fromBrowserData(source, index, collected);
  }

  if (source.category === "x") {
    return {
      ...source,
      index,
      status: "manual-review-required",
      title: source.name,
      description: source.note || "X requires manual login or API access for reliable collection.",
      links: [],
      articles: []
    };
  }

  try {
    const info = await fetchPageInfo(source.url, { articleRules: getArticleRules(source) });
    return {
      ...source,
      index,
      status: "ok",
      title: info.ogTitle || info.title || source.name,
      description: info.ogDescription || info.description || "",
      links: info.links || [],
      articles: info.articles || []
    };
  } catch (error) {
    return {
      ...source,
      index,
      status: "fetch-failed",
      title: source.name,
      description: error.message,
      links: [],
      articles: []
    };
  }
}

function statusLabel(status) {
  if (status === "ok") return "已扫描";
  if (status === "browser-collected") return "浏览器已采集";
  if (status === "manual-review-required") return "需人工登录核验";
  return "抓取失败";
}

function sourceLine(source) {
  return `${citation(source.index)} ${source.name}. ${statusLabel(source.status)}. ${source.url}`;
}

function sourceSummaryTable(collectedSources) {
  const rows = collectedSources.map((source) => {
    const articleCount = (source.articles || []).length;
    return `| ${source.index} | ${source.name} | ${source.layer} | ${source.category} | ${statusLabel(source.status)} | ${articleCount} |`;
  });

  return [
    "| 引用 | 信源 | 层级 | 类型 | 状态 | 抓到文章数 |",
    "| --- | --- | --- | --- | --- | ---: |",
    ...rows
  ].join("\n");
}

function formatArticleLine({ source, article }) {
  const tags = [];
  if (article.date) {
    tags.push(isWithinWeek(article.date, week) ? `🆕本周 ${article.date}` : article.date);
  } else {
    tags.push("日期待确认");
  }

  const meta = `（${tags.join("，")}）`;
  const summary = article.summary ? `\n  ${article.summary}` : "";
  return `- ${article.title} ${meta} ${citation(source.index)}\n  ${article.url}${summary}`;
}

// Render the best-available references for a layer: prefer parsed articles
// (real headlines pulled from listing pages), fall back to raw links. Articles
// are sorted with this week's items first, then by date descending.
function linksForLayer(collectedSources, layer) {
  const layerSources = collectedSources.filter(
    (source) => source.layer === layer || source.layer === "cross-layer"
  );

  const entries = layerSources.flatMap((source) =>
    (source.articles || []).map((article) => ({ source, article }))
  );

  if (entries.length > 0) {
    entries.sort((a, b) => articleRank(b.article) - articleRank(a.article));
    return entries.slice(0, 10).map(formatArticleLine).join("\n");
  }

  return layerSources
    .flatMap((source) => (source.links || []).slice(0, 3).map((link) => `- ${link.text} ${citation(source.index)}\n  ${link.href}`))
    .slice(0, 8)
    .join("\n");
}

// Sort key: this-week articles rank highest, then more recent dates, then
// undated articles last.
function articleRank(article) {
  if (article.date && isWithinWeek(article.date, week)) {
    return 3_000_000_000 + new Date(`${article.date}T00:00:00`).getTime();
  }
  if (article.date) {
    return new Date(`${article.date}T00:00:00`).getTime();
  }
  return -1;
}

function thisWeekArticleCount() {
  return collectedSources.reduce(
    (total, source) =>
      total + (source.articles || []).filter((article) => isWithinWeek(article.date, week)).length,
    0
  );
}

function browserCollectionNote() {
  const weekly = thisWeekArticleCount();
  const weeklyNote = `本周期（${week.label}）内自动识别到 ${weekly} 篇带日期的新文章。`;

  if (!browserCollection.generatedAt) {
    return `> 数据来源：本期未发现浏览器采集结果，登录受限信源（如 X、OpenAI News 等）仅做占位，请先运行 \`npm run collect:browser\` 再生成正式稿。${weeklyNote}`;
  }

  const usedCount = collectedSources.filter((source) => source.status === "browser-collected").length;
  return `> 数据来源：已合并浏览器采集结果（采集于 ${browserCollection.generatedAt}），其中 ${usedCount} 个信源使用了登录后采集的内容。${weeklyNote}`;
}

function buildReport(collectedSources) {
  const xSources = collectedSources.filter((source) => source.category === "x");
  const officialSources = collectedSources.filter((source) => source.category === "official-blog");
  const platformSources = collectedSources.filter((source) => source.layer === "platform");
  const productSources = collectedSources.filter((source) => source.layer === "product");

  return `# 本周 AI 资讯周报 Issue ${issue}

生成日期：${formatDateLabel(now)}

覆盖周期：${week.label}

## 执行摘要

本报告采用“三层框架”追踪 AI 产业变化：外延层关注全球前沿 AI 技术和模型研究突破，平台层关注重点 AI 平台的产品更新、生态变化与流量格局，产品层关注国内外核心玩家的产品变化、服务优势、商业模式与竞争动态。当前版本已经扫描必选官网与行业媒体首页，并将 X 账号与搜索页列为必审信源；由于 X 常要求登录或 API 权限，最终发布前必须人工补充本周高互动帖子与 KOL 观点。

${browserCollectionNote()}

${sourceSummaryTable(collectedSources)}

## 一、外延层：全球前沿 AI 技术

> 核心判断：本周外延层应重点判断顶尖实验室是否出现新的模型能力边界、研究范式变化或开源/闭源策略调整；OpenAI、Google DeepMind、Anthropic 及其研究人员的官方博客与 X 讨论必须作为主要证据链。${officialSources.map((source) => citation(source.index)).join("")}

### 重点事件分析

请在最终稿中围绕以下问题深挖：是否有新模型、新 benchmark、新安全评估、新多模态能力、新 agent 能力或推理成本下降信号。已扫描的官方信源包括 OpenAI News、Google DeepMind Blog 和 Anthropic News。${officialSources.map((source) => citation(source.index)).join("")}

本周文章（自动抓取，需人工复核）：

${linksForLayer(collectedSources, "extension") || "- 待从原文和 X 讨论中补充。"}

### 深挖方向

- 对比各实验室对“能力提升”和“安全边界”的叙事差异，判断是底层模型突破、产品化包装，还是生态位防守。
- 对重点论文、模型卡、系统卡、发布博客做二次验证，提取数据、限制条件和评估方法。
- 检查 @sama、@karpathy、@ylecun、@demishassabis、@OpenAI、@AnthropicAI、@GoogleDeepMind 的本周高互动观点。${xSources.map((source) => citation(source.index)).join("")}

## 二、平台层：全球重点 AI 平台变化趋势

> 核心判断：平台层应判断 AI 流量入口是否继续从传统搜索、独立网页和应用商店迁移到对话式、代理式和工作流式入口；Search Engine Land 与模型平台官网的变化需要联合解读。${platformSources.map((source) => citation(source.index)).join("")}

### 重点事件分析

平台层重点关注搜索产品、AI Overviews/AI Mode、浏览器入口、开发者平台、API 价格、插件/应用生态、分发入口和广告变现方式。Search Engine Land 作为搜索生态必选信源，应与 OpenAI、Google、Anthropic 等平台官方信息交叉验证。${platformSources.map((source) => citation(source.index)).join("")}

本周文章（自动抓取，需人工复核）：

${linksForLayer(collectedSources, "platform") || "- 待从平台公告、搜索行业媒体和流量数据中补充。"}

### 深挖方向

- 追踪搜索入口变化是否影响 SEO、内容站流量和企业获客成本。
- 对比模型平台是否在强化开发者生态、企业工作流、消费级订阅或广告化路径。
- 检查 API、模型官网和应用入口是否出现价格、限额、模型默认项或能力标签变化。

## 三、产品层：国内外核心玩家产品变化和服务优势

> 核心判断：产品层应重点判断 ChatGPT、Claude、Gemini、Perplexity、Kimi、豆包等产品是否在用户增长、商业模式、服务差异化和场景渗透上出现结构性变化。${productSources.map((source) => citation(source.index)).join("")}

### 重点事件分析

产品层需要同时覆盖海外核心玩家和国内核心玩家。海外侧重点包括订阅定价、模型默认能力、企业功能、搜索/浏览/agent 能力；国内侧重点包括 36Kr、虎嗅报道中的产品迭代、商业化进展、用户数据、渠道合作和监管环境。${productSources.map((source) => citation(source.index)).join("")}

本周文章（自动抓取，需人工复核）：

${linksForLayer(collectedSources, "product") || "- 待从产品官网、36Kr、虎嗅和公开数据中补充。"}

### 深挖方向

- 建立核心产品对比表：目标用户、主打能力、价格策略、入口形态、生态绑定和差异化服务。
- 对国内产品重点追踪 DAU/MAU、留存、付费转化、企业客户和渠道合作。
- 对海外产品重点追踪模型能力、工具链整合、工作流场景和企业合规。

## 跨层洞察

| 观察维度 | 外延层 | 平台层 | 产品层 | 综合判断 |
| --- | --- | --- | --- | --- |
| 技术能力 | 待从官方博客、论文和模型卡补充 | 待观察是否转化为平台默认能力 | 待观察是否进入用户可感知功能 | 技术突破只有进入平台分发和产品体验后，才会形成稳定竞争优势。 |
| 流量入口 | KOL 与实验室叙事塑造认知 | 搜索、浏览器、API 与应用平台重排入口 | 产品订阅和场景粘性决定留存 | 需要重点跟踪“搜索入口被 AI 回答替代”的商业影响。 |
| 商业化 | 模型能力决定供给边界 | 平台策略决定生态租金 | 产品包装决定付费意愿 | 同一模型能力在不同产品形态中会形成不同毛利和增长曲线。 |

## 完整信源索引

${collectedSources.map(sourceLine).join("\n")}

## 发布前检查清单

- [ ] X 搜索已完成，并补充本周 AI 热词、高互动帖子和 KOL 观点。
- [ ] OpenAI、Google DeepMind、Anthropic 官方博客均已覆盖，缺一不可。
- [ ] Search Engine Land、36Kr、虎嗅均已覆盖，缺一不可。
- [ ] 各大模型官网已复查，并记录产品、价格、模型入口或功能变化。
- [ ] 每条关键数据均有内联数字引用。
- [ ] 数据对比均使用 Markdown 表格。
- [ ] 文件名符合 \`weekly_ai_report_issue_N_mon_MMDD.md\`。
`;
}

const collectedSources = [];

for (let index = 0; index < sources.requiredSources.length; index += 1) {
  const source = sources.requiredSources[index];
  console.log(`Scanning ${index + 1}/${sources.requiredSources.length}: ${source.name}`);
  collectedSources.push(await collectSource(source, index + 1));
}

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, buildReport(collectedSources), "utf8");

console.log(`Report draft written to ${outputFile}`);
