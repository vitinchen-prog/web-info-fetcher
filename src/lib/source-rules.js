// Per-source article-extraction rules, keyed by the source name used in
// config/sources.json. Patterns are based on each site's published article URL
// structure. `include`/`exclude` are matched against the link pathname and href.
//
// Keeping these declarative (rather than hand-written parsers per site) means a
// single extraction engine handles every source, and adjusting a site only
// means tweaking a regex here.
const articleRules = {
  "OpenAI News": {
    // Posts live at openai.com/index/<slug>/
    include: /\/index\/[^/]+/i,
    limit: 8
  },
  "Google DeepMind Blog": {
    // Posts live at deepmind.google/discover/blog/<slug>/
    include: /\/discover\/blog\/[^/]+/i,
    exclude: /\/discover\/blog\/?$/i,
    limit: 8
  },
  "Anthropic News": {
    // Posts live at anthropic.com/news/<slug>
    include: /\/news\/[^/]+/i,
    exclude: /\/news\/?$/i,
    limit: 8
  },
  "Search Engine Land": {
    // Articles end with a numeric id, e.g. /some-headline-455123/
    include: /-\d{4,}\/?$/i,
    limit: 8
  },
  "36Kr AI": {
    // Articles live at 36kr.com/p/<id>
    include: /\/p\/\d+/i,
    limit: 8
  },
  "Huxiu AI": {
    // Articles live at huxiu.com/article/<id>.html
    include: /\/article\/\d+/i,
    limit: 8
  }
};

export function getArticleRules(source) {
  return articleRules[source.name] || null;
}

export { articleRules };
