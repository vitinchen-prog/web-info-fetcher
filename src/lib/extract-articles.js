import { stripTags } from "./html.js";

// Pull article-like links out of a listing/blog page using declarative rules.
// `rules` shape: { include?: RegExp, exclude?: RegExp, minTitleLength?: number, limit?: number }
// `include`/`exclude` are tested against both the URL pathname and the full href.
export function extractArticles(html, baseUrl, rules, options = {}) {
  if (!rules || !html) return [];

  const max = options.limit ?? rules.limit ?? 10;
  const minTitle = rules.minTitleLength ?? 6;
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const articles = [];
  const seen = new Set();
  let match;

  while ((match = anchorPattern.exec(html)) && articles.length < max) {
    const article = buildArticle(match[1], match[2], baseUrl, rules, minTitle, seen);
    if (article) {
      seen.add(article.url);
      articles.push(article);
    }
  }

  return articles;
}

// Apply the same rules to an already-extracted list of { text, href } links.
// Used for browser collections that only stored links, not full HTML.
export function articlesFromLinks(links = [], rules, options = {}) {
  if (!rules) return [];

  const max = options.limit ?? rules.limit ?? 10;
  const minTitle = rules.minTitleLength ?? 6;
  const articles = [];
  const seen = new Set();

  for (const link of links) {
    if (articles.length >= max) break;
    const article = buildArticle(link.href, link.text, link.href, rules, minTitle, seen);
    if (article) {
      seen.add(article.url);
      articles.push(article);
    }
  }

  return articles;
}

function buildArticle(rawHref, rawText, baseUrl, rules, minTitle, seen) {
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

  return { title, url: url.href };
}
