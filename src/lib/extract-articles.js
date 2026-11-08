import { elementText, elements, isArticleContainer, normalizeHttpUrl, parseHtml, stripTags } from './html.js';

// Article dates and summaries are extracted only from the link's own card.
// The original evidence accompanies each value so consumers can apply a gate.
export function extractArticles(html, baseUrl, rules, options = {}) {
  if (!rules || !html) return [];
  const root = parseHtml(html);
  const anchors = [...elements(root)].filter(node => node.tag === 'a');
  const urls = new Map(anchors.map(node => [node, articleUrl(node.attrs.href, baseUrl, rules)]));
  const articles = [];
  const seen = new Set();
  const max = options.limit ?? rules.limit ?? 10;

  for (const anchor of anchors) {
    if (articles.length >= max) break;
    const url = urls.get(anchor);
    if (!url || seen.has(url.href)) continue;
    const heading = [...elements(anchor)].find(node => /^h[1-6]$/.test(node.tag));
    const title = elementText(heading || anchor);
    if (title.length < (rules.minTitleLength ?? 6)) continue;
    const scope = cardFor(anchor, urls);
    const dateInfo = dateFromScope(scope, url.href);
    const summaryInfo = summaryFromScope(scope, anchor.attrs.title, title);
    seen.add(url.href);
    articles.push({ title, url: url.href, date: dateInfo?.date ?? null,
      summary: summaryInfo?.summary ?? '', dateEvidence: dateInfo?.evidence ?? null,
      summaryEvidence: summaryInfo?.evidence ?? null });
  }
  return articles;
}

// Accept both old {text, href} collections and newer {title, url} articles.
// A bare cached date is not publication evidence. URL dates can be recovered.
export function articlesFromLinks(links = [], rules, options = {}) {
  if (!rules || !Array.isArray(links)) return [];
  const articles = [];
  const seen = new Set();
  const max = options.limit ?? rules.limit ?? 10;
  for (const link of links) {
    if (articles.length >= max) break;
    if (!link || typeof link !== 'object') continue;
    const url = articleUrl(link.href ?? link.url, options.baseUrl, rules);
    if (!url || seen.has(url.href)) continue;
    const rawTitle = link.text ?? link.title;
    if (typeof rawTitle !== 'string') continue;
    const title = stripTags(rawTitle);
    if (title.length < (rules.minTitleLength ?? 6)) continue;
    const dateInfo = validatedDateEvidence(link, url.href);
    const summary = typeof link.summary === 'string' ? clamp(stripTags(link.summary)) : '';
    const evidence = link.summaryEvidence;
    const summaryEvidence = evidence && ['paragraph', 'title-attribute'].includes(evidence.kind)
      && typeof evidence.value === 'string' && summary && clamp(stripTags(evidence.value)) === summary
      ? { kind: evidence.kind, value: stripTags(evidence.value) } : null;
    seen.add(url.href);
    articles.push({ title, url: url.href, date: dateInfo?.date ?? null, summary,
      dateEvidence: dateInfo?.evidence ?? null, summaryEvidence });
  }
  return articles;
}

function articleUrl(rawHref, baseUrl, rules) {
  const url = normalizeHttpUrl(rawHref, baseUrl);
  if (!url) return null;
  const host = value => value.toLowerCase().replace(/^www\./, '');
  if (rules.hosts?.length) {
    if (!rules.hosts.some(value => host(value) === host(url.hostname))) return null;
  } else if (baseUrl) {
    const base = normalizeHttpUrl(baseUrl);
    if (!base || host(url.hostname) !== host(base.hostname) || url.port !== base.port) return null;
  }
  const matches = (pattern) => {
    if (!pattern) return false;
    // Do not let global/sticky regex lastIndex leak between articles, or let a
    // query parameter containing an article path impersonate that path.
    return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(url.pathname);
  };
  if ((rules.include && !matches(rules.include)) || matches(rules.exclude)) return null;
  return url;
}

function cardFor(anchor, urls) {
  let nearestBlock = null;
  for (let parent = anchor.parent; parent; parent = parent.parent) {
    if (['#root', 'html', 'body', 'main', 'section', 'ul', 'ol'].includes(parent.tag)
      || /(?:^|[\s_-])(listing|feed|grid|archive)(?:$|[\s_-])/i.test(parent.attrs.class || '')) break;
    const candidates = new Set([...elements(parent)].filter(node => node.tag === 'a')
      .map(node => urls.get(node)?.href).filter(Boolean));
    if (candidates.size !== 1) break;
    if (!nearestBlock && parent.tag === 'div') nearestBlock = parent;
    if (isArticleContainer(parent)) return parent;
  }
  // With no explicit card boundary, use only the closest block. Climbing every
  // single-link wrapper can borrow a page-level timestamp when a listing has
  // just one article.
  return nearestBlock || anchor;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function isoDate(year, month, day) {
  year = Number(year); month = Number(month); day = Number(day);
  if (!Number.isInteger(year) || year < 1000 || year > 9999
    || !Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateFromIso(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+-])(\d{2}):(\d{2}))?)?$/);
  if (!match || (match[4] !== undefined && (Number(match[4]) > 23 || Number(match[5]) > 59
    || Number(match[6] || 0) > 59 || Number(match[8] || 0) > 23 || Number(match[9] || 0) > 59))) return null;
  return isoDate(match[1], match[2], match[3]);
}

function dateFromUrl(href) {
  const url = normalizeHttpUrl(href);
  if (!url) return null;
  const match = url.pathname.match(/\/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})(?:\/|$)/);
  const date = match && isoDate(match[1], match[2], match[3]);
  return date ? { date, evidence: { kind: 'url', value: url.href } } : null;
}

function dateFromText(text) {
  const patterns = [
    { regex: /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g, parts: m => [m[1], m[2], m[3]] },
    { regex: /(20\d{2})年(\d{1,2})月(\d{1,2})日/g, parts: m => [m[1], m[2], m[3]] },
    { regex: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/gi, parts: m => [m[3], MONTHS[m[1].toLowerCase()], m[2]] },
    { regex: /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(20\d{2})\b/gi, parts: m => [m[3], MONTHS[m[2].toLowerCase()], m[1]] }
  ];
  for (const { regex, parts } of patterns) {
    for (const match of text.matchAll(regex)) {
      const date = isoDate(...parts(match));
      if (date) return { date, evidence: { kind: 'text', value: match[0] } };
    }
  }
  return null;
}

function isHeadline(node, scope) {
  for (let current = node; current; current = current.parent) {
    if (/^h[1-6]$/.test(current.tag)) return true;
    if (current === scope) break;
  }
  return false;
}

function publicationTextDate(scope) {
  for (const node of elements(scope)) {
    if (isHeadline(node, scope) || node.tag === 'a') continue;
    // Never aggregate a headline and the rest of its card into one date claim.
    if ([...elements(node)].some(child => child !== node && (child.tag === 'a' || /^h[1-6]$/.test(child.tag)))) continue;
    const marker = `${node.attrs.class || ''} ${node.attrs.id || ''} ${node.attrs.itemprop || ''}`;
    if (/(?:^|[\s_-])(?:event|conference|deadline|updated|modified)(?:$|[\s_-])/i.test(marker)) continue;
    const isMetadata = node.tag === 'time' || /\bdatePublished\b/i.test(node.attrs.itemprop || '')
      || /(?:^|[\s_:-])(?:published|publish-date|publication-date|date|timestamp)(?:$|[\s_:-])/i.test(marker);
    const text = elementText(node);
    if (isMetadata) {
      const info = dateFromText(node.attrs.content || node.attrs.datetime || text);
      if (info) return info;
    }
    const label = text.match(/^(?:(?:published|posted)(?:\s+(?:on|at))?\s*[:：]?\s*|发布日期\s*[:：]?\s*|发布于\s*|发布时间\s*[:：]?\s*)/i);
    if (label) {
      const value = text.slice(label[0].length);
      const info = dateFromText(value);
      // A publication label must directly introduce the date, rather than
      // prose such as "Published research about the event on November 5".
      if (info && value.startsWith(info.evidence.value)) return info;
    }
  }
  return null;
}

function dateFromScope(scope, href) {
  for (const node of elements(scope)) {
    if (node.tag !== 'time' || isHeadline(node, scope)) continue;
    const date = dateFromIso(node.attrs.datetime);
    if (date) return { date, evidence: { kind: 'time', value: node.attrs.datetime } };
  }
  return dateFromUrl(href) || publicationTextDate(scope);
}

function validatedDateEvidence(link, href) {
  const evidence = link.dateEvidence;
  if (evidence && typeof evidence.value === 'string' && ['time', 'text'].includes(evidence.kind)) {
    const date = evidence.kind === 'time' ? dateFromIso(evidence.value) : dateFromText(evidence.value)?.date;
    if (date && (!link.date || date === dateFromIso(link.date))) {
      return { date, evidence: { kind: evidence.kind, value: evidence.value } };
    }
  }
  return dateFromUrl(href);
}

// Compatibility helper for isolated date strings/fragments. Article extraction
// above deliberately does not use this permissive whole-text fallback.
export function findDate(windowHtml = '', href = '') {
  const scope = parseHtml(windowHtml);
  return (dateFromScope(scope, href) || dateFromText(elementText(scope)))?.date ?? null;
}

function summaryFromScope(scope, titleAttr, title) {
  const value = stripTags(titleAttr || '');
  if (value && value !== title) return { summary: clamp(value), evidence: { kind: 'title-attribute', value } };
  for (const paragraph of elements(scope)) {
    if (paragraph.tag !== 'p') continue;
    const text = elementText(paragraph);
    if (text.length >= 20 && text !== title) return { summary: clamp(text), evidence: { kind: 'paragraph', value: text } };
  }
  return null;
}

export function findSummary(windowHtml = '', openingTag = '', innerHtml = '') {
  const anchor = [...elements(parseHtml(`${openingTag}</a>`))].find(node => node.tag === 'a');
  return summaryFromScope(parseHtml(windowHtml), anchor?.attrs.title, stripTags(innerHtml))?.summary ?? '';
}

function clamp(value, max = 200) {
  return value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;
}
