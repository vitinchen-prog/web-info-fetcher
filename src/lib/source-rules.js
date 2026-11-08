// Hosts are exact except for a leading www. alias; path rules never match a
// query-string lookalike. Keep both current and historical publisher paths.
const articleRules = {
  'OpenAI News': {
    hosts: ['openai.com'],
    include: /^\/index\/[^/]+\/?$/i,
    limit: 8
  },
  'Google DeepMind Blog': {
    hosts: ['deepmind.google'],
    include: /^\/(?:discover\/)?blog\/[^/]+\/?$/i,
    limit: 8
  },
  'Anthropic News': {
    hosts: ['anthropic.com'],
    include: /^\/news\/[^/]+\/?$/i,
    limit: 8
  },
  'Search Engine Land': {
    hosts: ['searchengineland.com'],
    include: /^\/[^/]+-\d{4,}\/?$/i,
    limit: 8
  },
  '36Kr AI': {
    hosts: ['36kr.com'],
    include: /^\/p\/\d+\/?$/i,
    limit: 8
  },
  'Huxiu AI': {
    hosts: ['huxiu.com'],
    include: /^\/article\/\d+(?:\.html)?\/?$/i,
    limit: 8
  }
};

export function getArticleRules(source) {
  return articleRules[source?.name] || null;
}

export { articleRules };
