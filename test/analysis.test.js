import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeEvents } from "../src/lib/analysis.js";
const events = [{ id: "one", title: "Acme releases Atlas 2", topics: ["模型与研究"], articles: [
  { title: "Acme releases Atlas 2", summary: "Atlas 2 supports a 32K context window.", summaryEvidence: {kind:"paragraph",value:"Atlas 2 supports a 32K context window."}, url: "https://acme.test/atlas", source: { name: "Acme", category: "official-blog" } },
  { title: "Acme releases Atlas 2", summary: "", url: "https://news.test/atlas", source: { name: "News", category: "industry-media" } },
] }];

test("evidence analysis quotes only collected claims and attributes each supporting URL", async () => {
  const before = structuredClone(events);
  const result = await analyzeEvents(events, { policy: {}, env: {} });
  assert.equal(result.mode, "evidence-only");
  assert.deepEqual(result.warnings, []);
  const analysis = result.events[0].analysis;
  assert.equal(analysis.observations.length, 2);
  assert.ok(analysis.observations.some((item) => item.text === "Acme releases Atlas 2" && item.sourceUrls.length === 2));
  assert.ok(analysis.observations.some((item) => item.text === "Atlas 2 supports a 32K context window." && item.sourceUrls[0] === "https://acme.test/atlas"));
  assert.ok(analysis.limitations.length > 0);
  assert.match(analysis.implication, /如果|若|待|不足/);
  assert.deepEqual(events, before);
});

test("headline-only evidence never yields fabricated benchmarks or independent verification", async () => {
  const result = await analyzeEvents([{ ...events[0], articles: [{ ...events[0].articles[0], summary: "" }] }], {});
  const analysis = result.events[0].analysis;
  assert.deepEqual(analysis.observations.map((entry) => entry.text), ["Acme releases Atlas 2"]);
  assert.ok(analysis.limitations.some((text) => /标题/.test(text)));
  assert.ok(analysis.limitations.some((text) => /独立|核验/.test(text)));
  assert.doesNotMatch(analysis.implication, /领先|降低成本|提高|增长|效率/);
});

test("LLM requests always downgrade explicitly without paid calls, including when keys are supplied", async () => {
  for (const env of [{}, { OPENAI_API_KEY: "not-a-real-key" }]) {
    const result = await analyzeEvents(events, { policy: { analysis: { mode: "llm" } }, env });
    assert.equal(result.mode, "evidence-only");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /未配置|未实现|unsupported|not configured/i);
  }
});

test("an absent evidence body is disclosed, not replaced by the event title", async () => {
  const result = await analyzeEvents([{ id: "unsupported", title: "Do not invent this claim", articles: [] }], {});
  assert.deepEqual(result.events[0].analysis.observations, []);
  assert.ok(result.events[0].analysis.limitations.some((text) => /不足|缺少|没有/.test(text)));
});


test("unsupported or mismatched legacy summaries are not elevated to observations", () => {
  const article = {...events[0].articles[0], summary: "Invented benchmark result", summaryEvidence: {kind:"paragraph",value:"A different source statement"}};
  const result = analyzeEvents([{...events[0],articles:[article]}]);
  assert.deepEqual(result.events[0].analysis.observations.map(o=>o.text), ["Acme releases Atlas 2"]);
  assert.ok(result.events[0].analysis.limitations.some(text=>/摘要/.test(text)));
});

test("conditional guidance is selected from supported pricing, model and search observations", () => {
  const samples = [
    {title:"Acme changes API pricing", phrase:/计费|配额/, term:"api"},
    {title:"Acme releases a new model", phrase:/基准|工作负载/, term:"model"},
    {title:"Acme search rollout expands", phrase:/流量|可见度/, term:"search"},
  ];
  for (const sample of samples) {
    const result = analyzeEvents([{id:"one",title:sample.title,articles:[{title:sample.title,url:"https://source.test/post"}]}]);
    const analysis = result.events[0].analysis;
    assert.match(analysis.implication,sample.phrase);
    assert.ok(analysis.implicationEvidence.terms.includes(sample.term));
    assert.deepEqual(analysis.implicationEvidence.sourceUrls,["https://source.test/post"]);
    assert.match(analysis.implication,/若|如果/);
  }
});

test("unsupported metadata and summaries cannot trigger topical business implications", () => {
  const result = analyzeEvents([{id:"one",title:"Search model API pricing",topics:["搜索与分发"],articles:[{
    title:"Acme announces a research initiative",summary:"API pricing reduces cost",url:"https://source.test/post"
  }]}]);
  const analysis = result.events[0].analysis;
  assert.deepEqual(analysis.implicationEvidence,{terms:[],sourceUrls:[]});
  assert.match(analysis.implication,/不足|不推导/);
});
