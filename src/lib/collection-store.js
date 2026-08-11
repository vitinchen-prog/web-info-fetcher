import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const browserOutputDir = path.resolve("data/browser-collections");

const emptyCollection = () => ({ generatedAt: null, file: null, byName: new Map(), byUrl: new Map() });

// Load the most recent browser collection file (if any) and index its results by
// source name and URL so the report generator can reuse logged-in content.
// Intentionally free of any browser/playwright imports so the report generator
// can run without those dependencies installed.
export async function loadLatestBrowserCollection() {
  let files;

  try {
    files = await readdir(browserOutputDir);
  } catch {
    return emptyCollection();
  }

  const collectionFiles = files
    .filter((file) => file.startsWith("browser_collection_") && file.endsWith(".json"))
    .sort();

  if (collectionFiles.length === 0) {
    return emptyCollection();
  }

  const latest = collectionFiles[collectionFiles.length - 1];
  let parsed;

  try {
    parsed = JSON.parse(await readFile(path.join(browserOutputDir, latest), "utf8"));
  } catch {
    return emptyCollection();
  }

  const byName = new Map();
  const byUrl = new Map();

  for (const result of parsed.results || []) {
    if (result.name) byName.set(result.name, result);
    if (result.url) byUrl.set(result.url, result);
  }

  return { generatedAt: parsed.generatedAt || null, file: latest, byName, byUrl };
}
