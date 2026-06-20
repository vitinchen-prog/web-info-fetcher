import { stripTags } from "./html.js";

// Pull article-like links out of a listing/blog page using declarative rules.
// `rules` shape: { include?: RegExp, exclude?: RegExp, minTitleLength?: number, limit?: number }
// `include`/`exclude` are tested against both the URL pathname and the full href.
// Each returned article is { title, url, date, summary } where `date` is an ISO
// YYYY-MM-DD string (or null) and `summary` is a short string (or "").
export function extractArticles(html, baseUrl, rules, options = {}) {
  if (!rules || !html) return [];

  const max = options.limit ?? rules.limit ?? 10;
  const minTitle = rules.minTitleLength ?? 6;
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const articles = [];
  const seen = new Set();
  let match;

  while ((match = anchorPattern.exec(html)) && articles.length < max) {
    const windowHtml = html.slice(
      Math.max(0, match.index - 200),
      Math.min(html.length, anchorPattern.lastIndex + 600)
    );
    const openingTag = match[0].slice(0, match[0].indexOf(">") + 1);
    const extra = {
      date: findDate(windowHtml, match[1]),
      summary: findSummary(windowHtml, openingTag, match[2])
    };

    const article = buildArticle(match[1], match[2], baseUrl, rules, minTitle, seen, extra);
    if (article) {
      seen.add(article.url);
      articles.push(article);
    }
  }

  return articles;
}

// Apply the same rules to an already-extracted list of { text, href } links.
// Used for browser collections that only stored links, not full HTML, so no
// date/summary context is available.
export function articlesFromLinks(links = [], rules, options = {}) {
  if (!rules) return [];

  const max = options.limit ?? rules.limit ?? 10;
  const minTitle = rules.minTitleLength ?? 6;
  const articles = [];
  const seen = new Set();

  for (const link of links) {
    if (articles.length >= max) break;
    const article = buildArticle(link.href, link.text, link.href, rules, minTitle, seen, {
      date: link.date ?? null,
      summary: link.summary ?? ""
    });
    if (article) {
      seen.add(article.url);
      articles.push(article);
    }
  }

  return articles;
}

function buildArticle(rawHref, rawText, baseUrl, rules, minTitle, seen, extra = {}) {
  let url;

  try {
    url = new URL(rawHref, baseUrl);
  } catch {
    return null;
  }

  const candidates = [url.pathname, url.href];
  const included = !rules.include || candidates.some((value) => rules.include.test(value));
  const excluded = rules.exclude && candidates.some((value) => rules.exclude.test(value));

  if (!included || excluded) return null;

  const title = stripTags(rawText);
  if (title.length < minTitle || seen.has(url.href)) return null;

  return { title, url: url.href, date: extra.date ?? null, summary: extra.summary ?? "" };
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

// Look for a publish date near an article link and normalise it to YYYY-MM-DD.
// Tries, in order: <time datetime>, a date in the href, ISO text, Chinese
// "YYYY年M月D日", and English "Month D, YYYY".
export function findDate(windowHtml = "", href = "") {
  const datetime = windowHtml.match(/datetime=["'](\d{4}-\d{2}-\d{2})/i);
  if (datetime) return datetime[1];

  const hrefDate = href.match(/\/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?:\/|$)/);
  if (hrefDate) return isoDate(hrefDate[1], hrefDate[2], hrefDate[3]);

  const iso = windowHtml.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return isoDate(iso[1], iso[2], iso[3]);

  const chinese = windowHtml.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (chinese) return isoDate(chinese[1], chinese[2], chinese[3]);

  const english = windowHtml.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i
  );
  if (english) {
    const month = MONTHS[english[1].toLowerCase()];
    return isoDate(english[3], month, english[2]);
  }

  return null;
}

// Best-effort one-line summary for an article: prefer the anchor's title
// attribute, otherwise the first reasonable <p> in the surrounding block.
export function findSummary(windowHtml = "", openingTag = "", innerHtml = "") {
  const titleAttr = openingTag.match(/\btitle=["']([^"']+)["']/i);
  if (titleAttr) {
    const value = stripTags(titleAttr[1]);
    if (value && value !== stripTags(innerHtml)) return clamp(value);
  }

  const paragraph = windowHtml.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (paragraph) {
    const value = stripTags(paragraph[1]);
    if (value.length >= 20) return clamp(value);
  }

  return "";
}

function isoDate(year, month, day) {
  const mm = String(Number(month)).padStart(2, "0");
  const dd = String(Number(day)).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function clamp(value, max = 200) {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}
