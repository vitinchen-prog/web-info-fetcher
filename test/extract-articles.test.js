import assert from "node:assert/strict";
import { test } from "node:test";
import { articlesFromLinks, extractArticles, findDate } from "../src/lib/extract-articles.js";
import { getArticleRules } from "../src/lib/source-rules.js";
import { isWithinWeek } from "../src/lib/report-utils.js";

test("extracts OpenAI news posts and ignores nav links", () => {
  const html = `
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <main>
      <a href="/index/new-model-release/">Introducing our new model</a>
      <a href="/index/safety-update/"><h3>A safety update for developers</h3></a>
      <a href="https://twitter.com/openai">Follow us</a>
    </main>
  `;
  const rules = getArticleRules({ name: "OpenAI News" });
  const articles = extractArticles(html, "https://openai.com/news/", rules);

  assert.equal(articles.length, 2);
  assert.equal(articles[0].title, "Introducing our new model");
  assert.equal(articles[0].url, "https://openai.com/index/new-model-release/");
  assert.equal(articles[1].title, "A safety update for developers");
});

test("Anthropic rules exclude the listing page itself", () => {
  const html = `
    <a href="/news">News</a>
    <a href="/news/claude-next">Meet Claude Next</a>
    <a href="/news/enterprise-launch">Enterprise launch details</a>
  `;
  const rules = getArticleRules({ name: "Anthropic News" });
  const articles = extractArticles(html, "https://www.anthropic.com/news", rules);

  assert.equal(articles.length, 2);
  assert.ok(articles.every((article) => article.url !== "https://www.anthropic.com/news"));
});

test("36Kr rules match numeric article ids", () => {
  const html = `
    <a href="/search/articles/AI">More</a>
    <a href="https://36kr.com/p/2987654321">某大模型本周获新一轮融资</a>
    <a href="/p/2987600000">国产芯片厂商发布推理卡</a>
  `;
  const rules = getArticleRules({ name: "36Kr AI" });
  const articles = extractArticles(html, "https://36kr.com/search/articles/AI", rules);

  assert.equal(articles.length, 2);
  assert.equal(articles[0].url, "https://36kr.com/p/2987654321");
});

test("respects the per-source limit", () => {
  const links = Array.from({ length: 20 }, (_, i) =>
    `<a href="/index/post-${i}/">Article number ${i} headline</a>`
  ).join("\n");
  const rules = getArticleRules({ name: "OpenAI News" });
  const articles = extractArticles(links, "https://openai.com/news/", rules);

  assert.equal(articles.length, rules.limit);
});

test("articlesFromLinks applies the same rules to collected links", () => {
  const links = [
    { text: "Home", href: "https://www.huxiu.com/" },
    { text: "本周 AI 产品观察", href: "https://www.huxiu.com/article/123456.html" },
    { text: "x", href: "https://www.huxiu.com/article/789012.html" } // too short title
  ];
  const rules = getArticleRules({ name: "Huxiu AI" });
  const articles = articlesFromLinks(links, rules);

  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, "本周 AI 产品观察");
});

test("returns nothing when there are no rules", () => {
  const html = `<a href="/anything">A link</a>`;
  assert.deepEqual(extractArticles(html, "https://example.com", null), []);
  assert.deepEqual(articlesFromLinks([{ text: "A link", href: "https://example.com/x" }], null), []);
});

test("findDate normalises the supported date formats", () => {
  assert.equal(findDate('<time datetime="2026-06-18T09:00:00Z">Jun 18</time>'), "2026-06-18");
  assert.equal(findDate("", "https://site.com/2026/06/05/some-slug"), "2026-06-05");
  assert.equal(findDate("Published 2026-6-7 by staff"), "2026-06-07");
  assert.equal(findDate("发布于 2026年6月3日"), "2026-06-03");
  assert.equal(findDate("Posted June 1, 2026"), "2026-06-01");
  assert.equal(findDate("no date here"), null);
});

test("extractArticles attaches date and summary from surrounding markup", () => {
  const html = `
    <article>
      <a href="/index/launch-day/">Launch day recap</a>
      <time datetime="2026-06-18">June 18, 2026</time>
      <p>A detailed recap of everything announced on launch day for developers.</p>
    </article>
  `;
  const rules = getArticleRules({ name: "OpenAI News" });
  const [article] = extractArticles(html, "https://openai.com/news/", rules);

  assert.equal(article.date, "2026-06-18");
  assert.match(article.summary, /detailed recap/);
});

test("isWithinWeek bounds dates inclusively", () => {
  const week = { monday: new Date("2026-06-15T00:00:00"), sunday: new Date("2026-06-21T00:00:00") };
  assert.equal(isWithinWeek("2026-06-15", week), true);
  assert.equal(isWithinWeek("2026-06-21", week), true);
  assert.equal(isWithinWeek("2026-06-14", week), false);
  assert.equal(isWithinWeek("2026-06-22", week), false);
  assert.equal(isWithinWeek(null, week), false);
});
