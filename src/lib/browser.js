import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { extractLinks, findMeta, findTitle } from "./html.js";

export const chromeExecutablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const browserProfileDir = path.resolve(".auth/browser-profile");
export const browserOutputDir = path.resolve("data/browser-collections");

export async function launchPersistentBrowser({ headless = false } = {}) {
  await mkdir(browserProfileDir, { recursive: true });

  return chromium.launchPersistentContext(browserProfileDir, {
    executablePath: process.env.CHROME_PATH || chromeExecutablePath,
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
    text: text.slice(0, options.textLimit ?? 12000)
  };
}
