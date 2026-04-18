import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchPageInfo } from "./lib/fetch-page-info.js";
import { formatDateLabel } from "./lib/report-utils.js";

const sources = JSON.parse(await readFile(new URL("../config/sources.json", import.meta.url), "utf8"));
const outputDir = path.resolve("reports");
const outputFile = path.join(outputDir, "source_crawl_status.md");

async function checkSource(source) {
  const started = Date.now();

  if (source.category === "x") {
    return {
      ...source,
      result: "browser-login-required",
      ms: 0,
      title: source.name,
      detail: "X requires logged-in browser automation or official API access for reliable weekly collection.",
      links: 0
    };
  }

  try {
    const info = await fetchPageInfo(source.url);
    return {
      ...source,
      result: "ok",
      ms: Date.now() - started,
      title: info.ogTitle || info.title || "",
      detail: info.ogDescription || info.description || "",
      links: info.links.length
    };
  } catch (error) {
    return {
      ...source,
      result: "failed",
      ms: Date.now() - started,
      title: "",
      detail: error.message,
      links: 0
    };
  }
}

function statusLabel(result) {
  if (result === "ok") return "可直接抓取";
  if (result === "browser-login-required") return "需浏览器登录";
  return "不可直接抓取";
}

function buildMarkdown(results) {
  const rows = results.map((source) => {
    const detail = source.detail.replaceAll("\n", " ").replaceAll("|", "\\|");
    const title = source.title.replaceAll("|", "\\|");
    return `| ${source.name} | ${source.category} | ${statusLabel(source.result)} | ${source.ms} | ${source.links} | ${title || detail} |`;
  });

  return `# Source Crawl Status

Checked at: ${formatDateLabel(new Date())}

| Source | Type | Status | ms | Links | Detail |
| --- | --- | --- | ---: | ---: | --- |
${rows.join("\n")}

## Recommended Collection Modes

| Mode | Sources |
| --- | --- |
| Direct Node fetch | Anthropic News, 36Kr, Huxiu, Claude, Kimi, Doubao |
| Browser automation | X, OpenAI News, Search Engine Land, ChatGPT, Gemini, Perplexity |
| Needs retry or browser fallback | Google DeepMind Blog |
`;
}

const results = [];

for (const source of sources.requiredSources) {
  console.log(`Checking: ${source.name}`);
  results.push(await checkSource(source));
}

await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, buildMarkdown(results), "utf8");

console.log(`Source crawl status written to ${outputFile}`);
