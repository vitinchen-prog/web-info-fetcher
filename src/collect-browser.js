import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { browserOutputDir, collectWithBrowser, launchPersistentBrowser } from "./lib/browser.js";
import { formatDateForFilename } from "./lib/report-utils.js";

const sources = JSON.parse(await readFile(new URL("../config/sources.json", import.meta.url), "utf8"));
const mode = process.argv.includes("--all") ? "all" : "browser";
const today = formatDateForFilename(new Date());
const outputFile = path.join(browserOutputDir, `browser_collection_${today}.json`);

function shouldUseBrowser(source) {
  if (mode === "all") return true;
  return source.category === "x" || [
    "OpenAI News",
    "Google DeepMind Blog",
    "Search Engine Land",
    "ChatGPT",
    "Gemini",
    "Perplexity"
  ].includes(source.name);
}

await mkdir(browserOutputDir, { recursive: true });

const context = await launchPersistentBrowser({ headless: false });
const page = context.pages()[0] || (await context.newPage());
const results = [];

for (const source of sources.requiredSources.filter(shouldUseBrowser)) {
  console.log(`Collecting with browser: ${source.name}`);

  try {
    results.push({
      status: "ok",
      ...(await collectWithBrowser(page, source))
    });
  } catch (error) {
    results.push({
      status: "failed",
      name: source.name,
      url: source.url,
      category: source.category,
      layer: source.layer,
      collectedAt: new Date().toISOString(),
      error: error.message
    });
  }
}

await context.close();
await writeFile(outputFile, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), "utf8");

console.log(`Browser collection written to ${outputFile}`);
