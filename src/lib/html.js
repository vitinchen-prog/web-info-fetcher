const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”'
};

export function decodeHtml(value = '') {
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : '\uFFFD';
  }).trim();
}

const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const IGNORED_ELEMENTS = new Set(['nav', 'script', 'style', 'code', 'pre', 'template', 'noscript', 'svg']);
const RAW_ELEMENTS = new Set(['script', 'style', 'textarea', 'title']);

export function isArticleContainer(node) {
  return ['article', 'li'].includes(node.tag) || node.attrs?.role === 'article'
    || /(?:^|\s)(?:[\w-]+-)?(?:card|post|item|entry)(?:$|\s)/i.test(node.attrs?.class || '');
}

// A conservative tokenizer, not a browser DOM. Keeping element boundaries lets
// callers scope evidence to a card without borrowing text from adjacent cards.
export function parseHtml(html = '') {
  html = String(html ?? '');
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  const stack = [root];
  const tokens = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[a-z][a-z0-9:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  let offset = 0;
  let match;
  const addText = (value) => {
    if (value) stack.at(-1).children.push({ tag: '#text', value, parent: stack.at(-1) });
  };

  while ((match = tokens.exec(html))) {
    addText(html.slice(offset, match.index));
    const token = match[0];
    offset = tokens.lastIndex;
    if (token.startsWith('<!')) continue;
    const tagMatch = token.match(/^<\/?([a-z][a-z0-9:-]*)/i);
    const tag = tagMatch[1].toLowerCase();
    if (token.startsWith('</')) {
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === tag) { stack.length = index; break; }
      }
      continue;
    }
    // Common optional end tags: do not merge neighboring list items or anchors.
    if (['li', 'a', 'p'].includes(tag)) {
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === tag) { stack.length = index; break; }
        if (['article', 'main', 'section', 'ul', 'ol'].includes(stack[index].tag)) break;
      }
    }
    const attrs = Object.create(null);
    const attributeText = token.slice(tagMatch[0].length, -1);
    const attributes = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const attr of attributeText.matchAll(attributes)) {
      const name = attr[1].toLowerCase();
      if (!(name in attrs)) attrs[name] = decodeHtml(attr[2] ?? attr[3] ?? attr[4] ?? '');
    }
    const node = { tag, attrs, children: [], parent: stack.at(-1) };
    const pageChrome = ['header', 'footer'].includes(tag) && !stack.some(isArticleContainer);
    node.ignored = IGNORED_ELEMENTS.has(tag) || pageChrome || 'hidden' in attrs || attrs['aria-hidden'] === 'true'
      || /^(navigation|banner|contentinfo)$/i.test(attrs.role || '')
      || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style || '');
    stack.at(-1).children.push(node);
    if (RAW_ELEMENTS.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'gi');
      close.lastIndex = offset;
      const end = close.exec(html);
      node.children.push({ tag: '#text', value: html.slice(offset, end?.index ?? html.length), parent: node });
      offset = end ? close.lastIndex : html.length;
      tokens.lastIndex = offset;
    } else if (!VOID_ELEMENTS.has(tag)) {
      stack.push(node);
    }
  }
  addText(html.slice(offset));
  return root;
}

export function* elements(node) {
  if (!node || node.ignored) return;
  if (node.tag !== '#text' && node.tag !== '#root') yield node;
  for (const child of node.children || []) yield* elements(child);
}

export function elementText(node) {
  const parts = [];
  const visit = (current) => {
    if (!current || current.ignored) return;
    if (current.tag === '#text') parts.push(decodeHtml(current.value));
    else for (const child of current.children || []) visit(child);
  };
  visit(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function stripTags(value = '') {
  return elementText(parseHtml(value));
}

export function findTitle(html) {
  const title = [...elements(parseHtml(html))].find(node => node.tag === 'title');
  return title ? elementText(title) || null : null;
}

export function findMeta(html, name) {
  const wanted = String(name).toLowerCase();
  const meta = [...elements(parseHtml(html))].find(node => node.tag === 'meta'
    && [node.attrs.name, node.attrs.property].some(value => value?.toLowerCase() === wanted));
  return meta?.attrs.content ?? null;
}

export function normalizeHttpUrl(rawHref, baseUrl) {
  if (typeof rawHref !== 'string' || !rawHref.trim() || rawHref.trim().startsWith('#')) return null;
  try {
    const url = new URL(decodeHtml(rawHref), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const name of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|_ga|_gl)$/i.test(name)) url.searchParams.delete(name);
    }
    url.searchParams.sort();
    return url;
  } catch {
    return null;
  }
}

export function extractLinks(html, baseUrl, limit = 12) {
  const links = [];
  const seen = new Set();
  for (const node of elements(parseHtml(html))) {
    if (links.length >= limit) break;
    if (node.tag !== 'a') continue;
    const url = normalizeHttpUrl(node.attrs.href, baseUrl);
    const text = elementText(node);
    if (!url || !text || seen.has(url.href)) continue;
    seen.add(url.href);
    links.push({ text, href: url.href });
  }
  return links;
}
