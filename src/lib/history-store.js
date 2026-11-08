import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
const stringList = (value) => Array.isArray(value) && value.every(nonempty);
const timestamp = (value) => nonempty(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const unique = (values) => [...new Set(values)];

export function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

// Preserve meaningful query parameters; remove only known tracking parameters.
export function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|dclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeHeadline(value) {
  return typeof value === "string"
    ? (value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+(?:\.[\p{L}\p{N}]+)*/gu) || []).join(" ")
    : "";
}

const stopWords = new Set("a an the and or for of in on to with by from at new latest introducing introduce introduces introduced announcing announce announces announced launch launches launched release releases released unveils unveil unveiled".split(" "));
const entityWords = new Set("openai anthropic google deepmind microsoft meta nvidia amazon apple alibaba baidu tencent bytedance moonshot mistral deepseek xai gpt claude gemini llama qwen kimi doubao grok opus sonnet haiku pro flash ultra mini nano".split(" "));
function titleTerms(title) {
  const words = normalizeHeadline(title).split(" ").filter(Boolean);
  return words.filter((word) => !stopWords.has(word));
}
function numbers(title) {
  return unique((normalizeHeadline(title).match(/\d+(?:\.\d+)*(?:[a-z]+)?/g) || [])).sort().join("|");
}
function entities(title) {
  return unique(titleTerms(title).filter((word) => entityWords.has(word))).sort().join("|");
}

// A reused "latest" URL must not collapse a new model version or another named model.
export function compatibleHeadlines(left, right) {
  const a = numbers(left), b = numbers(right);
  if (a && b && a !== b) return false;
  const x = entities(left), y = entities(right);
  return !(x && y && x !== y);
}

export function headlineSignature(title) {
  return createHash("sha256").update(titleTerms(title).join(" ")).digest("hex");
}

export function sameHeadline(left, right) {
  const a = normalizeHeadline(left), b = normalizeHeadline(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (!compatibleHeadlines(a, b) || numbers(a) !== numbers(b) || entities(a) !== entities(b)) return false;
  const first = titleTerms(a), second = titleTerms(b);
  // Requiring the leading substantive term protects unknown companies/entities too.
  if (first.length < 4 || second.length < 4 || first[0] !== second[0]) return false;
  const x = new Set(first), y = new Set(second);
  const shared = [...x].filter((term) => y.has(term)).length;
  // Unmatched substantive terms on both sides could name different entities or claims.
  if (shared < x.size && shared < y.size) return false;
  // Token reorder can invert a claim even when all words are identical.
  const commonFirst = first.filter((word) => y.has(word)).join(" ");
  const commonSecond = second.filter((word) => x.has(word)).join(" ");
  return commonFirst === commonSecond && shared / new Set([...x, ...y]).size >= 0.85;
}

export function emptyHistory() {
  return { version: 1, events: [], deliveries: [] };
}

export function validateHistory(history) {
  if (!history || history.version !== 1 || !Array.isArray(history.events) || !Array.isArray(history.deliveries)) {
    throw new Error("Invalid or unsupported history schema; refusing to reset delivery state.");
  }
  for (const entry of history.events) {
    if (!entry || !nonempty(entry.id) || !nonempty(entry.title) || !validDate(entry.date)
      || !stringList(entry.urls) || !entry.urls.length || entry.urls.some((url) => !canonicalUrl(url))
      || !stringList(entry.headlines) || !entry.headlines.length
      || !stringList(entry.signatures) || !entry.signatures.length
      || !timestamp(entry.sentAt) || !nonempty(entry.reportHash) || !nonempty(entry.messageId)) {
      throw new Error("Invalid history event record; refusing to discard sent-event evidence.");
    }
  }
  for (const entry of history.deliveries) {
    const pending = entry?.status === "pending" && entry.sentAt === null && timestamp(entry.attemptedAt);
    const sent = entry?.status === "sent" && timestamp(entry.sentAt) && nonempty(entry.messageId);
    if (!entry || !nonempty(entry.reportHash) || !stringList(entry.eventIds) || (!pending && !sent)
      || (entry.attemptedAt !== undefined && !timestamp(entry.attemptedAt))) {
      throw new Error("Invalid history delivery record; refusing to discard send status.");
    }
  }
  const eventIds = new Set(history.events.map((entry) => entry.id));
  if (eventIds.size !== history.events.length) throw new Error("Invalid history: duplicate event IDs.");
  const sent = history.deliveries.filter((entry) => entry.status === "sent");
  if (sent.some((entry) => entry.eventIds.some((id) => !eventIds.has(id)))
    || history.events.some((event) => !sent.some((entry) => entry.reportHash === event.reportHash && entry.messageId === event.messageId && entry.eventIds.includes(event.id)))) {
    throw new Error("Invalid history: broken sent-event delivery references.");
  }
  return history;
}

export async function loadHistory(file) {
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return emptyHistory();
    throw new Error(`Cannot read history: ${error.message}`, { cause: error });
  }
  try {
    return validateHistory(JSON.parse(contents));
  } catch (error) {
    throw new Error(`Cannot load history; manual recovery required: ${error.message}`, { cause: error });
  }
}

// Temp file + fsync + same-directory rename avoids exposing partial JSON to readers.
export async function saveHistory(file, history) {
  validateHistory(history);
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(history, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
  } finally {
    if (handle) await handle.close();
    await rm(temporary, { force: true });
  }
}

// Pure state transition. The caller must invoke this only after confirmed SMTP success.
export function recordDelivery(history, events, { reportHash, sentAt, messageId }) {
  validateHistory(history);
  if (!nonempty(reportHash) || !timestamp(sentAt) || !nonempty(messageId)) {
    throw new Error("Delivery requires reportHash, ISO sentAt and a successful SMTP messageId.");
  }
  const next = structuredClone(history);
  if (next.deliveries.some((entry) => entry.status === "sent" && entry.reportHash === reportHash && entry.messageId === messageId)) return next;
  for (const event of events) {
    const headlines = unique((event.articles || []).map((article) => normalizeHeadline(article.title)).filter(Boolean));
    const entry = {
      id: event.id, title: event.title, date: event.date,
      urls: unique((event.articles || []).map((article) => canonicalUrl(article.url)).filter(Boolean)),
      headlines, signatures: unique(headlines.map(headlineSignature)), sentAt, reportHash, messageId,
    };
    const existing = next.events.find((item) => item.id === event.id);
    if (existing) {
      for (const key of ["urls", "headlines", "signatures"]) existing[key] = unique([...existing[key], ...entry[key]]);
    } else next.events.push(entry);
  }
  const pendingIndex = next.deliveries.findIndex((entry) => entry.status === "pending" && entry.reportHash === reportHash);
  const prior = pendingIndex >= 0 ? next.deliveries[pendingIndex] : {};
  if (pendingIndex >= 0 && (prior.eventIds.length !== new Set(events.map((event) => event.id)).size
    || prior.eventIds.some((id) => !events.some((event) => event.id === id)))) {
    throw new Error("Cannot confirm delivery: event IDs differ from the pending attempt.");
  }
  const delivery = { ...prior, reportHash, status: "sent", sentAt, messageId, eventIds: unique(events.map((event) => event.id)) };
  if (pendingIndex >= 0) next.deliveries[pendingIndex] = delivery;
  else next.deliveries.push(delivery);
  return validateHistory(next);
}
