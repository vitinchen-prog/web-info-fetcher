import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEvents } from "../src/lib/events.js";
import { emptyHistory, recordDelivery } from "../src/lib/history-store.js";

const now = new Date("2026-11-06T12:00:00Z");
const week = { monday: new Date("2026-11-02T00:00:00Z"), sunday: new Date("2026-11-08T00:00:00Z") };
const options = (extra = {}) => ({ now, week, history: emptyHistory(), ...extra });
const article = (title, url, extra = {}) => ({ title, url, date: "2026-11-05", dateEvidence: {kind: "time", value: extra.date ?? "2026-11-05"}, summary: "", ...extra });
const source = (articles, extra = {}) => ({ name: "Official", url: "https://official.test/news", index: 1, category: "official-blog", layer: "extension", status: "ok", articles, ...extra });

test("only dated, in-period, non-future articles with usable source evidence become events", () => {
  const result = buildEvents([source([
    article("A documented model launch", "https://official.test/valid"),
    article("Missing publication date", "https://official.test/no-date", { date: null }),
    article("Past model announcement", "https://official.test/old", { date: "2026-10-31" }),
    article("Future model announcement", "https://official.test/future", { date: "2026-11-07" }),
    article("Impossible model announcement", "https://official.test/invalid", { date: "2026-02-30" }),
    article("", "https://official.test/no-title"),
    article("Not a source URL", "javascript:alert(1)"),
    article("Untrusted date evidence", "https://official.test/untrusted", { dateEvidence: null }),
  ]), source([article("Missing publisher identity", "https://missing.test/post")], { name: "" })], options());
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, "A documented model launch");
  assert.equal(result.suppressedCount, 8);
});

test("canonical URL and exact headlines deduplicate while retaining every source article", () => {
  const sources = [source([
    article("OpenAI introduces GPT-5.1", "https://official.test/gpt/?utm_source=news#top"),
    article("Introducing our latest model", "https://official.test/gpt"),
  ]), source([article("OPENAI introduces GPT-5.1!", "https://media.test/gpt")], { name: "Media", url: "https://media.test", index: 2, category: "industry-media", layer: "platform" })];
  const snapshot = structuredClone(sources);
  const result = buildEvents(sources, options());
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].articles.length, 3);
  assert.deepEqual(result.events[0].articles[2].source, { name: "Media", url: "https://media.test", index: 2, category: "industry-media", layer: "platform" });
  assert.equal(result.suppressedCount, 2);
  assert.deepEqual(sources, snapshot);
});

test("strong related headlines merge, but different versions, entities and substantive query URLs remain distinct", () => {
  const result = buildEvents([source([
    article("OpenAI launches GPT-5.1 for enterprise developers", "https://official.test/one"),
    article("OpenAI releases GPT-5.1 for enterprise developers", "https://media.test/two"),
    article("OpenAI releases GPT-5.2 for enterprise developers", "https://official.test/three"),
    article("Anthropic releases GPT-5.1 for enterprise developers", "https://official.test/four"),
    article("Acme launches powerful agent model for enterprise teams and developers", "https://official.test/posts?id=1"),
    article("Other launches powerful agent model for enterprise teams and developers", "https://official.test/posts?id=2"),
  ])], options());
  assert.equal(result.events.length, 5);
  assert.equal(result.events.find((event) => event.title.includes("launches GPT")).articles.length, 2);
});

test("one reused URL cannot collapse distinct model versions", () => {
  const { events } = buildEvents([source([
    article("Introducing Claude 4.5", "https://official.test/latest"),
    article("Introducing Claude 4.6", "https://official.test/latest"),
  ])], options());
  assert.equal(events.length, 2);
});

test("topic scores, official evidence and independent-source counts rank events deterministically", () => {
  const policy = { scoring: { topics: [{ name: "Search", keywords: ["search"], weight: 2 }], weights: { recency: 0, officialSource: 2, multiSource: 3, topic: 4 }, minScore: 0, maxEvents: 10 } };
  const { events } = buildEvents([
    source([article("Acme search update", "https://official.test/search"), article("Other product update", "https://official.test/other")]),
    source([article("Acme search update", "https://media.test/search")], { name: "Media", url: "https://media.test", category: "industry-media", index: 2 }),
    source([article("Acme search update", "https://media.test/search-copy")], { name: "Media Alias", url: "https://media.test/news", category: "industry-media", index: 3 }),
  ], options({ policy }));
  assert.equal(events[0].title, "Acme search update");
  assert.equal(events[0].score, 13);
  assert.deepEqual(events[0].topics, ["Search"]);
  assert.ok(events[0].scoreReasons.every((reason) => typeof reason === "string"));
  assert.equal(events[1].score, 2);
  assert.equal(buildEvents([source([article("Acme search update", "https://official.test/search")])], options({ policy: { scoring: { ...policy.scoring, minScore: 11 } } })).events.length, 0);
  assert.equal(buildEvents([source([article("First launch event", "https://official.test/first"), article("Second unrelated event", "https://official.test/second")])], options({ policy: { scoring: { maxEvents: 1 } } })).events.length, 1);
});

test("sent events are suppressed across periods and alternative URLs, while newer versions survive", () => {
  const first = buildEvents([source([article("OpenAI launches GPT-5.1 for enterprise developers", "https://official.test/gpt-5-1")])], options()).events;
  const history = recordDelivery(emptyHistory(), first, { reportHash: "report-one", sentAt: "2026-11-06T13:00:00Z", messageId: "<message-one>" });
  const result = buildEvents([source([
    article("OpenAI releases GPT-5.1 for enterprise developers", "https://other.test/new-coverage", { date: "2026-11-10" }),
    article("OpenAI releases GPT-5.2 for enterprise developers", "https://official.test/gpt-5-2", { date: "2026-11-10" }),
  ])], options({ now: new Date("2026-11-13T12:00:00Z"), week: { monday: "2026-11-09", sunday: "2026-11-15" }, history }));
  assert.equal(result.events.length, 1);
  assert.match(result.events[0].title, /5\.2/);
  assert.equal(result.suppressedCount, 1);
});

test("invalid history and invalid scoring options cannot silently reset or weaken gating", () => {
  assert.throws(() => buildEvents([], options({ history: { version: 99, events: [], deliveries: [] } })), /history/i);
  assert.throws(() => buildEvents([], options({ policy: { scoring: { maxEvents: -1 } } })), /maxEvents/);
  assert.throws(() => buildEvents([], options({ now: "bad date" })), /date|now/i);
});


test("legacy naked dates, malformed evidence and mismatched date provenance are excluded", () => {
  const naked = article("A naked date is insufficient", "https://official.test/naked");
  delete naked.dateEvidence;
  const { events } = buildEvents([source([
    naked,
    article("Unknown evidence must not qualify", "https://official.test/unknown", { dateEvidence: {kind: "guess", value: "2026-11-05"} }),
    article("Mismatched date must not qualify", "https://official.test/mismatch", { dateEvidence: {kind: "time", value: "2025-11-05"} }),
    article("Unrelated URL must not qualify", "https://official.test/2025/11/05/old", { dateEvidence: {kind: "url", value: "https://official.test/2026/11/05/new"} }),
  ])], options());
  assert.equal(events.length, 0);
});

test("today follows the Shanghai calendar at the UTC day boundary", () => {
  const { events } = buildEvents([source([article("Shanghai Monday release", "https://official.test/monday", { date: "2026-11-09" })])], options({ now: new Date("2026-11-08T17:00:00Z"), week: { start: "2026-11-09", end: "2026-11-15" } }));
  assert.equal(events.length, 1);
});

test("strong similarity does not merge unknown entities embedded in long headlines", () => {
  const { events } = buildEvents([source([
    article("New enterprise model from Acme improves support for software teams in many business applications across industry sectors", "https://official.test/acme"),
    article("New enterprise model from Other improves support for software teams in many business applications across industry sectors", "https://official.test/other"),
  ])], options());
  assert.equal(events.length, 2);
});

test("word-order signatures do not suppress reversed claims in later reporting", () => {
  const first = buildEvents([source([article("Acme replaces Other in enterprise search", "https://official.test/first")])], options()).events;
  const history = recordDelivery(emptyHistory(), first, { reportHash: "report-order", sentAt: "2026-11-06T13:00:00Z", messageId: "<message-order>" });
  const { events } = buildEvents([source([article("Other replaces Acme in enterprise search", "https://official.test/reversed")])], options({ history }));
  assert.equal(events.length, 1);
});


test("a later timestamp today is still future evidence", () => {
  const {events} = buildEvents([source([article("A scheduled announcement", "https://official.test/scheduled", {date:"2026-11-06",dateEvidence:{kind:"time",value:"2026-11-06T23:00:00Z"}})])], options());
  assert.equal(events.length, 0);
});

test("invalid and future local timestamps cannot supply date evidence", () => {
  const {events} = buildEvents([source([
    article("Malformed timestamp", "https://official.test/badtime", {dateEvidence:{kind:"time",value:"2026-11-05Tnot-a-time"}}),
    article("Later in Shanghai today", "https://official.test/later", {date:"2026-11-06",dateEvidence:{kind:"time",value:"2026-11-06T22:00:00"}}),
  ])], options());
  assert.equal(events.length, 0);
});

test("retained URL, headline and signature indexes each suppress previously delivered evidence", () => {
  const sent = buildEvents([source([article("OpenAI launches GPT-5.1 for enterprise developers", "https://official.test/indexed")])], options()).events;
  const history = recordDelivery(emptyHistory(), sent, { reportHash:"indexes",sentAt:"2026-11-06T13:00:00Z",messageId:"<indexes>" });
  const result = buildEvents([source([
    article("An alternate title about this release", "https://official.test/indexed?utm_source=again"),
    article("OpenAI launches GPT-5.1 for enterprise developers", "https://media.test/same-headline"),
    article("OpenAI releases GPT-5.1 for enterprise developers", "https://media.test/same-signature"),
  ])], options({history}));
  assert.deepEqual(result.events, []);
});

test("a reused URL for a newer version is not suppressed by past delivery", () => {
  const sent = buildEvents([source([article("Claude 4.5 model launch", "https://official.test/latest")])], options()).events;
  const history = recordDelivery(emptyHistory(), sent, {reportHash:"old-version",sentAt:"2026-11-06T13:00:00Z",messageId:"<old>"});
  const {events} = buildEvents([source([article("Claude 4.6 model launch", "https://official.test/latest")])], options({history}));
  assert.equal(events.length, 1);
});
