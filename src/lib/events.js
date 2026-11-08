import { createHash } from "node:crypto";
import { canonicalUrl, compatibleHeadlines, emptyHistory, headlineSignature, normalizeHeadline, sameHeadline, validDate, validateHistory } from "./history-store.js";

import { findDate } from "./extract-articles.js";
import { shanghaiDate } from "./report-utils.js";
import { supportedSummary } from "./analysis.js";

const DEFAULT_TOPICS = [
  { name: "模型与研究", keywords: ["model", "gpt", "claude", "gemini", "模型", "研究"], weight: 1 },
  { name: "搜索与分发", keywords: ["search", "seo", "geo", "搜索", "分发"], weight: 1 },
  { name: "产品与商业化", keywords: ["api", "pricing", "enterprise", "产品", "价格", "商业化"], weight: 1 },
];
const DEFAULT_WEIGHTS = { recency: 3, officialSource: 2, multiSource: 2, topic: 1 };
const official = (article) => article.source.category === "official-blog" || article.source.category === "model-product";

function scoringConfig(policy) {
  const input = policy.scoring ?? {};
  const result = { topics: input.topics ?? DEFAULT_TOPICS, weights: { ...DEFAULT_WEIGHTS, ...input.weights }, minScore: input.minScore ?? 0, maxEvents: input.maxEvents ?? 30 };
  for (const [key, value] of Object.entries({ ...result.weights, minScore: result.minScore })) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Invalid scoring ${key}: expected a finite nonnegative number.`);
  }
  if (!Number.isInteger(result.maxEvents) || result.maxEvents < 1) throw new Error("Invalid scoring maxEvents: expected a positive integer.");
  if (!Array.isArray(result.topics) || result.topics.some((topic) => !topic || typeof topic.name !== "string" || !topic.name.trim()
    || !Array.isArray(topic.keywords) || !topic.keywords.length || topic.keywords.some((word) => typeof word !== "string" || !word.trim())
    || typeof topic.weight !== "number" || !Number.isFinite(topic.weight) || topic.weight < 0)) {
    throw new Error("Invalid scoring topics: expected name, nonempty keywords and nonnegative weight.");
  }
  return result;
}

function day(value, label) {
  const result = value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null) : value;
  if (!validDate(result)) throw new Error(`Invalid ${label} date.`);
  return result;
}

function supportedDate(article, now) {
  const evidence = article.dateEvidence;
  if (!evidence || !["time", "text", "url"].includes(evidence.kind) || typeof evidence.value !== "string" || !evidence.value.trim()) return false;
  if (evidence.kind === "time") {
    if (!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/.test(evidence.value)
      || evidence.value.slice(0, 10) !== article.date) return false;
    if (evidence.value.includes("T")) {
      // A local timestamp without an offset follows the report's Shanghai timezone.
      const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(evidence.value) ? evidence.value : `${evidence.value}+08:00`;
      const instant = Date.parse(zoned);
      if (!Number.isFinite(instant) || instant > now.getTime()) return false;
    }
    return true;
  }
  if (evidence.kind === "url") return canonicalUrl(evidence.value) === canonicalUrl(article.url) && findDate("", article.url) === article.date;
  return findDate(evidence.value.replaceAll("<", "&lt;").replaceAll(">", "&gt;")) === article.date;
}

function sameArticle(a, b) {
  if (!compatibleHeadlines(a.title, b.title)) return false;
  return canonicalUrl(a.url) === canonicalUrl(b.url) || sameHeadline(a.title, b.title);
}

function previouslySent(event, history) {
  const titles = event.articles.map((article) => article.title);
  const urls = event.articles.map((article) => canonicalUrl(article.url));
  return history.events.some((past) => {
    if (past.id === event.id) return true;
    if (!titles.every((title) => compatibleHeadlines(title, past.title))) return false;
    if (past.urls.some((url) => urls.includes(canonicalUrl(url)))) return true;
    return titles.some((title) => past.headlines.some((headline) => sameHeadline(title, headline))
      || past.signatures.includes(headlineSignature(title)));
  });
}

function keywordPresent(text, keyword) {
  const normalized = normalizeHeadline(keyword);
  if (/[\u3400-\u9fff]/.test(normalized)) return text.includes(normalized);
  return ` ${text} `.includes(` ${normalized} `);
}

function scoreEvent(event, config, today) {
  const evidence = normalizeHeadline(event.articles.map((article) => `${article.title} ${supportedSummary(article)}`).join(" "));
  const matched = config.topics.filter((topic) => topic.keywords.some((word) => keywordPresent(evidence, word)));
  const hosts = new Set(event.articles.map((article) => new URL(article.source.url).hostname.replace(/^www\./, "")));
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${event.date}T00:00:00Z`)) / 86_400_000;
  const contributions = [
    ["时间接近度", config.weights.recency * Math.max(0, 1 - age / 7)],
    ["官方来源", config.weights.officialSource * Number(event.articles.some(official))],
    ["不同来源域名（不代表独立核验）", config.weights.multiSource * Math.min(2, Math.max(0, hosts.size - 1))],
    ["主题匹配", config.weights.topic * matched.reduce((total, topic) => total + topic.weight, 0)],
  ];
  event.score = Math.round(contributions.reduce((total, [, value]) => total + value, 0) * 100) / 100;
  event.scoreReasons = contributions.filter(([, value]) => value > 0).map(([reason, value]) => `${reason} +${Number(value.toFixed(2))}`);
  event.topics = matched.map((topic) => topic.name);
  return event;
}

// suppressedCount counts every input article not represented as a distinct selected event
// (including duplicate evidence retained inside selected events).
export function buildEvents(collectedSources, { now = new Date(), week, policy = {}, history = emptyHistory() } = {}) {
  validateHistory(history);
  const config = scoringConfig(policy);
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid now date.");
  const today = shanghaiDate(instant);
  const start = day(week?.start ?? week?.monday, "week start");
  const end = day(week?.end ?? week?.sunday, "week end");
  if (start > end) throw new Error("Invalid week date order.");
  const groups = [];
  let totalArticles = 0;
  for (const source of collectedSources) {
    for (const article of source.articles || []) {
      totalArticles += 1;
      if (!source.name?.trim() || !canonicalUrl(source.url) || ["fetch-failed", "manual-review-required"].includes(source.status)
        || !article || !normalizeHeadline(article.title) || !canonicalUrl(article.url)
        || !validDate(article.date) || article.date < start || article.date > end || article.date > today
        || !supportedDate(article, instant)) continue;
      const evidence = { ...article, source: { name: source.name, url: source.url, index: source.index, category: source.category, layer: source.layer } };
      const group = groups.find((items) => items.every((item) => compatibleHeadlines(item.title, evidence.title)) && items.some((item) => sameArticle(item, evidence)));
      if (group) group.push(evidence);
      else groups.push([evidence]);
    }
  }
  const candidates = groups.map((articles) => {
    const preferred = articles.find(official) || articles[0];
    const event = {
      id: `event_${createHash("sha256").update(normalizeHeadline(preferred.title)).digest("hex").slice(0, 24)}`,
      title: preferred.title, date: articles.map((article) => article.date).sort()[0], layer: preferred.source.layer || "cross-layer", articles,
    };
    return scoreEvent(event, config, today);
  }).filter((event) => !previouslySent(event, history) && event.score >= config.minScore);
  candidates.sort((a, b) => b.score - a.score || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const events = candidates.slice(0, config.maxEvents);
  return { events, suppressedCount: totalArticles - events.length };
}
