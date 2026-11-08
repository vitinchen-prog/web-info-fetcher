import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { articlesFromLinks, extractArticles, findDate } from '../src/lib/extract-articles.js';
import { decodeHtml, extractLinks } from '../src/lib/html.js';
import { getArticleRules } from '../src/lib/source-rules.js';

const openai = getArticleRules({ name: 'OpenAI News' });
const base = 'https://openai.com/news/';
const fixture = await readFile(new URL('./fixtures/article-cards.html', import.meta.url), 'utf8');

test('article extraction ignores page chrome, executable examples and off-source URLs', () => {
  assert.deepEqual(extractArticles(fixture, base, openai).map(a => a.url), [
    'https://openai.com/index/undated/', 'https://openai.com/index/dated/'
  ]);
});

test('an undated card never borrows its neighbor date or summary', () => {
  const [undated, dated] = extractArticles(fixture, base, openai);
  assert.equal(undated.date, null);
  assert.equal(undated.summary, '');
  assert.equal(dated.date, '2026-11-06');
  assert.deepEqual(dated.dateEvidence, { kind: 'time', value: '2026-11-06T08:00:00Z' });
  assert.equal(dated.summary, 'This source describes a new model with verified details for developers.');
  assert.deepEqual(dated.summaryEvidence, { kind: 'paragraph', value: dated.summary });
});

test('generic cards and repeated links stay scoped to one article', () => {
  const articles = extractArticles(`<main>
    <div><a href=/index/first/>An undated first research card</a></div>
    <div><a href=/index/second/><img src=x></a><h2><a href=/index/second/>A second research card</a></h2><time datetime='2026-11-05'>November 5, 2026</time><p>The second card has a clear standalone source summary.</p></div>
  </main>`, base, openai);
  assert.equal(articles.length, 2);
  assert.equal(articles[0].date, null);
  assert.equal(articles[0].summary, '');
  assert.equal(articles[1].date, '2026-11-05');
  assert.equal(articles[1].summary, 'The second card has a clear standalone source summary.');
});

test('listing-level dates do not become article publication dates', () => {
  const [article] = extractArticles('<main><time datetime="2026-11-07">Today</time><a href="/index/undated/">An undated research announcement</a></main>', base, openai);
  assert.equal(article.date, null);
});

test('invalid calendar dates are rejected while leap days remain valid', () => {
  for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-11-31', '2026-01-00']) {
    assert.equal(findDate(`<time datetime="${value}">date</time>`), null, value);
    assert.equal(findDate('', `https://site.example/${value.replaceAll('-', '/')}/news`), null, value);
  }
  assert.equal(findDate('<time datetime="2024-02-29T08:10:00Z">Leap day</time>'), '2024-02-29');
});

test('date evidence can come from the card text or an article URL', () => {
  const [textDate] = extractArticles('<article><a href="/index/text-date/">A dated research announcement</a><span>发布于 2026年11月2日</span></article>', base, openai);
  assert.equal(textDate.date, '2026-11-02');
  assert.deepEqual(textDate.dateEvidence, { kind: 'text', value: '2026年11月2日' });
  const [urlDate] = extractArticles('<a href="/2026/11/03/news">A dated article URL</a>', 'https://example.com', { include: /^\/2026\// });
  assert.equal(urlDate.date, '2026-11-03');
  assert.deepEqual(urlDate.dateEvidence, { kind: 'url', value: 'https://example.com/2026/11/03/news' });
});

test('legacy browser records are normalized and unsupported dates are discarded', () => {
  const articles = articlesFromLinks([
    { text: 'Unsupported old browser date', href: 'https://openai.com/index/legacy/?utm_campaign=weekly#top', date: '2026-11-07', summary: 'An older cached summary without recorded source evidence.' },
    { title: 'An evidence-backed browser article', url: 'https://openai.com/index/evidence/', date: '2026-11-06', dateEvidence: { kind: 'time', value: '2026-11-06T10:00:00Z' }, summary: 'A source summary backed by the paragraph on its article card.', summaryEvidence: { kind: 'paragraph', value: 'A source summary backed by the paragraph on its article card.' } },
    { text: 'An inconsistent date claim', href: 'https://openai.com/index/mismatch/', date: '2026-11-07', dateEvidence: { kind: 'time', value: '2026-11-06' } },
    { text: 'A non-http source link', href: 'javascript:/index/invalid/' },
    { text: 'An off-source browser link', href: 'https://evil.example/index/foreign/' },
    null
  ], openai);
  assert.equal(articles.length, 3);
  assert.equal(articles[0].url, 'https://openai.com/index/legacy/');
  assert.equal(articles[0].date, null);
  assert.equal(articles[0].dateEvidence, null);
  assert.equal(articles[0].summaryEvidence, null);
  assert.equal(articles[1].date, '2026-11-06');
  assert.deepEqual(articles[1].dateEvidence, { kind: 'time', value: '2026-11-06T10:00:00Z' });
  assert.deepEqual(articles[1].summaryEvidence, { kind: 'paragraph', value: articles[1].summary });
  assert.equal(articles[2].date, null);
});

test('legacy URL dates are verified against the actual URL instead of supplied evidence', () => {
  const rules = { include: /^\/20\d\d\//, hosts: ['example.com'] };
  const [article] = articlesFromLinks([{ text: 'A dated browser link', href: 'https://example.com/2026/11/04/article', date: '2026-11-07', dateEvidence: { kind: 'url', value: 'https://example.com/2026/11/07/article' } }], rules);
  assert.equal(article.date, '2026-11-04');
  assert.deepEqual(article.dateEvidence, { kind: 'url', value: 'https://example.com/2026/11/04/article' });
});

test('source rules support both current and old DeepMind blog paths', () => {
  const rules = getArticleRules({ name: 'Google DeepMind Blog' });
  const articles = extractArticles('<a href="/blog/new-discovery/">A current discovery announcement</a><a href="/discover/blog/old-discovery/">An older discovery announcement</a><a href="/blog/">All discoveries</a>', 'https://deepmind.google/blog/', rules);
  assert.deepEqual(articles.map(a => a.url), ['https://deepmind.google/blog/new-discovery/', 'https://deepmind.google/discover/blog/old-discovery/']);
});

test('URL matching ignores query spoofing and stateful regular expressions', () => {
  const rules = { include: /^\/index\/[^/]+\/?$/g };
  const articles = extractArticles('<a href="/index/one/">First valid headline</a><a href="/index/two/">Second valid headline</a><a href="/login?next=/index/fake/">A spoofed path headline</a>', base, rules);
  assert.deepEqual(articles.map(a => a.url), ['https://openai.com/index/one/', 'https://openai.com/index/two/']);
});

test('link extraction decodes entities, strips tracking and ignores hidden or unsafe links', () => {
  const links = extractLinks('<nav><a href="/nav">Navigation</a></nav><main><a href="/news?a=1&amp;utm_source=mail#top">AI&#x20;&amp;&#32;research</a><a href="/news?a=1">Duplicate</a><a href="javascript:alert(1)">Unsafe</a><div aria-hidden="true"><a href="/hidden">Hidden example</a></div></main>', 'https://example.com');
  assert.deepEqual(links, [{ text: 'AI & research', href: 'https://example.com/news?a=1' }]);
  assert.equal(decodeHtml('AI&nbsp;&#8212;&#x4E2D;&#x6587;'), 'AI —中文');
});

test('adjacent article cards cannot leak dates or summaries even at short distances', () => {
  const [first, second] = extractArticles('<article><a href="/index/first/">First undated announcement</a></article><article><a href="/index/second/">Second dated announcement</a><time datetime="2026-11-06">Nov 6</time><p>Only the second announcement has this detailed source summary.</p></article>', base, openai);
  assert.equal(first.date, null);
  assert.equal(first.summary, '');
  assert.equal(second.date, '2026-11-06');
});

test('a generic card does not inherit a listing wrapper date or summary', () => {
  const [article] = extractArticles('<main><div class="listing"><time datetime="2026-11-07">Updated today</time><p>This is a shared introduction for the whole news listing page.</p><div><h2><a href="/index/undated/">An undated article in its own card</a></h2></div></div></main>', base, openai);
  assert.equal(article.date, null);
  assert.equal(article.summary, '');
});

test('date text in a hidden template cannot establish publication evidence', () => {
  const [article] = extractArticles('<article><a href="/index/undated/">An undated research announcement</a><template><time datetime="2026-11-07">Current date</time></template></article>', base, openai);
  assert.equal(article.date, null);
});

test('article URLs use the known publisher host even when the page base is foreign', () => {
  const articles = extractArticles('<a href="/index/fake/">A redirected foreign article</a><a href="https://openai.com/index/real/">A real publisher article</a>', 'https://foreign.example/blog/', openai);
  assert.deepEqual(articles.map(a => a.url), ['https://openai.com/index/real/']);
});

test('uppercase HTML tags with mixed-case attribute values parse without losing links', () => {
  const [article] = extractArticles('<ARTICLE><A TITLE="A detailed announcement at the official source." HREF="/index/uppercase/">An uppercase markup announcement</A><TIME DATETIME="2026-11-06">Nov 6</TIME></ARTICLE>', base, openai);
  assert.equal(article?.url, 'https://openai.com/index/uppercase/');
  assert.equal(article.summary, 'A detailed announcement at the official source.');
  assert.equal(article.date, '2026-11-06');
});

test('malformed browser titles and summaries are not coerced into source claims', () => {
  const articles = articlesFromLinks([
    { href: 'https://openai.com/index/bad-title/', text: { injected: 'headline' } },
    { href: 'https://openai.com/index/valid/', text: 'A valid article headline', summary: { injected: 'summary' } }
  ], openai);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].summary, '');
});

test('impossible timestamps cannot support a cached publication date', () => {
  const articles = articlesFromLinks([
    { href: 'https://openai.com/index/bad-time/', text: 'An invalid publication time', date: '2026-11-06', dateEvidence: { kind: 'time', value: '2026-11-06T99:88:00Z' } },
    { href: 'https://openai.com/index/trailing/', text: 'A malformed publication time', date: '2026-11-06', dateEvidence: { kind: 'time', value: '2026-11-06T12:30garbage' } }
  ], openai);
  assert.ok(articles.every(article => article.date === null));
});

test('semantic article headers and footers remain visible while page chrome is ignored', () => {
  const articles = extractArticles('<header><a href="/index/page-nav/">A page navigation headline</a></header><main><article><header><h2><a href="/index/article-header/">A genuine article header headline</a></h2><time datetime="2026-11-06">Nov 6</time></header></article><div class="news-card"><header><h2><a href="/index/card-footer/">A genuine card headline</a></h2></header><footer><time datetime="2026-11-05">Nov 5</time></footer></div></main><footer><a href="/index/page-footer/">A page footer navigation headline</a></footer>', base, openai);
  assert.deepEqual(articles.map(article => [article.url, article.date]), [
    ['https://openai.com/index/article-header/', '2026-11-06'],
    ['https://openai.com/index/card-footer/', '2026-11-05']
  ]);
});

test('headline event dates cannot override a labeled publication date', () => {
  const [article] = extractArticles('<article><a href="/index/conference/">Join conference on November 5, 2026</a><p>Published November 3, 2024</p></article>', base, openai);
  assert.equal(article.date, '2024-11-03');
  assert.deepEqual(article.dateEvidence, { kind: 'text', value: 'November 3, 2024' });
});

test('unlabeled headline and summary event dates are not publication evidence', () => {
  const [article] = extractArticles('<article><h2><a href="/index/conference/">Join conference on November 5, 2026</a></h2><p>Our conference will run on November 6, 2026, with invited researchers.</p></article>', base, openai);
  assert.equal(article.date, null);
  assert.equal(article.dateEvidence, null);
});

test('publication metadata is used ahead of unrelated card prose', () => {
  const articles = extractArticles('<article><a href="/index/first/">Conference announced for November 6, 2026</a><span class="publish-date">November 2, 2024</span></article><article><a href="/index/second/">Conference announced for November 6, 2026</a><meta itemprop="datePublished" content="2024-11-01"></article><article><a href="/index/third/">Conference announced for November 6, 2026</a><time>October 31, 2024</time></article>', base, openai);
  assert.deepEqual(articles.map(article => article.date), ['2024-11-02', '2024-11-01', '2024-10-31']);
});
