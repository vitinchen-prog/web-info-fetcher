import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyHistory, loadHistory, saveHistory, recordDelivery } from "../src/lib/history-store.js";
const events = [{ id: "event-one", title: "OpenAI releases GPT-5.1", date: "2026-11-05", articles: [{ title: "OpenAI releases GPT-5.1", url: "https://example.test/gpt/?utm_source=test#top" }] }];
const delivery = { reportHash: "hash-one", sentAt: "2026-11-06T12:00:00Z", messageId: "<mail-one>" };

test("recordDelivery produces independent durable identities and keeps its input unchanged", () => {
  const empty = emptyHistory();
  const saved = recordDelivery(empty, events, delivery);
  assert.deepEqual(empty, { version: 1, events: [], deliveries: [] });
  assert.equal(saved.events.length, 1);
  assert.deepEqual(saved.events[0].urls, ["https://example.test/gpt"]);
  assert.ok(saved.events[0].headlines.includes("openai releases gpt 5.1"));
  assert.equal(saved.events[0].signatures.length, 1);
  assert.deepEqual(saved.deliveries[0].eventIds, ["event-one"]);
  assert.equal(recordDelivery(saved, events, delivery).deliveries.length, 1);
  assert.throws(() => recordDelivery(empty, events, { ...delivery, messageId: "" }), /messageId/);
});

test("history round trips atomically and a missing file is the only automatic initialization", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "report-history-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "state", "history.json");
  assert.deepEqual(await loadHistory(file), { version: 1, events: [], deliveries: [] });
  const saved = recordDelivery(emptyHistory(), events, delivery);
  await saveHistory(file, saved);
  assert.deepEqual(await loadHistory(file), saved);
  assert.deepEqual(await readdir(path.dirname(file)), ["history.json"]);
  assert.equal(JSON.parse(await readFile(file, "utf8")).version, 1);
  await assert.rejects(saveHistory(file, { version: 2, events: [], deliveries: [] }), /history/i);
  assert.deepEqual(await loadHistory(file), saved);
});

test("corrupt, unknown and malformed histories fail closed without overwrite", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "report-history-invalid-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "history.json");
  for (const contents of ["{bad json", "null", '{"version":2,"events":[],"deliveries":[]}', '{"version":1,"events":[{}],"deliveries":[]}']) {
    await writeFile(file, contents);
    await assert.rejects(loadHistory(file), /history/i);
    assert.equal(await readFile(file, "utf8"), contents);
  }
  await assert.rejects(loadHistory(dir), /history/i);
});

test("successful delivery replaces its pending send record and preserves other pending attempts", () => {
  const history = emptyHistory();
  history.deliveries.push({ reportHash: delivery.reportHash, status: "pending", sentAt: null, attemptedAt: "2026-11-06T11:59:00Z", eventIds: ["event-one"] });
  const saved = recordDelivery(history, events, delivery);
  assert.equal(saved.deliveries.length, 1);
  assert.equal(saved.deliveries[0].status, "sent");
  assert.equal(saved.deliveries[0].attemptedAt, "2026-11-06T11:59:00Z");
  assert.equal(history.deliveries[0].status, "pending");
});

test("broken sent-event references and duplicate event IDs fail closed", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "report-history-links-"));
  t.after(() => rm(dir, {recursive:true,force:true}));
  const file = path.join(dir, "history.json");
  const saved = recordDelivery(emptyHistory(), events, delivery);
  const corruptions = [
    {...saved, events:[]},
    {...saved, deliveries:[]},
    {...saved, events:[...saved.events,...saved.events]},
  ];
  for (const invalid of corruptions) {
    await writeFile(file,JSON.stringify(invalid));
    await assert.rejects(loadHistory(file), /history/i);
  }
});

test("a delivery cannot confirm different events than the persisted pending attempt", () => {
  const history = emptyHistory();
  history.deliveries.push({reportHash:delivery.reportHash,status:"pending",sentAt:null,attemptedAt:"2026-11-06T11:59:00Z",eventIds:["different-event"]});
  assert.throws(() => recordDelivery(history,events,delivery), /pending|event/i);
});
