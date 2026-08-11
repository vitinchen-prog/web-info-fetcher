import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { browserOutputDir } from "./collection-store.js";
import { extractArticles } from "./extract-articles.js";
import { extractLinks, findMeta, findTitle } from "./html.js";
import { getArticleRules } from "./source-rules.js";

export const browserProfileDir = path.resolve(".auth/browser-profile");
export { browserOutputDir };

// Common Chrome / Chromium locations per platform. The first one that exists wins.
const chromeCandidates = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium"
  ]
};

export function resolveChromePath() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  const candidates = chromeCandidates[process.platform] || chromeCandidates.linux;
  const found = candidates.find((candidate) => existsSync(candidate));

  if (!found) {
    throw new Error(
      `Could not find a Chrome/Chromium executable for platform "${process.platform}". ` +
        `Set the CHROME_PATH environment variable to your browser binary, e.g. ` +
        `CHROME_PATH="/path/to/chrome" npm run collect:browser`
    );
  }

  return found;
}

export async function launchPersistentBrowser({ headless = false } = {}) {
  await mkdir(browserProfileDir, { recursive: true });

  return chromium.launchPersistentContext(browserProfileDir, {
    executablePath: resolveChromePath(),
    headless,
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
  });
}

export async function collectWithBrowser(page, source, options = {}) {
  const waitMs = options.waitMs ?? 5000;
  const scrolls = options.scrolls ?? 2;

  await page.goto(source.url, {
    waitUntil: "domcontentloaded",
    timeout: options.timeoutMs ?? 45000
  });

  await page.waitForTimeout(waitMs);

  for (let index = 0; index < scrolls; index += 1) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1200);
  }

  const html = await page.content();
  const title = (await page.title()) || findTitle(html) || source.name;
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const links = extractLinks(html, source.url, options.linkLimit ?? 30);

  return {
    name: source.name,
    url: source.url,
    category: source.category,
    layer: source.layer,
    collectedAt: new Date().toISOString(),
    title,
    description: findMeta(html, "description") || findMeta(html, "og:description") || "",
    links,
    articles: extractArticles(html, source.url, getArticleRules(source)),
    text: text.slice(0, options.textLimit ?? 12000)
  };
}
