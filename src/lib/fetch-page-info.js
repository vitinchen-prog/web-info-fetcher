import { extractLinks, findMeta, findTitle } from "./html.js";

export async function fetchPageInfo(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Please provide a valid URL, for example: https://example.com");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;

  try {
    response = await fetch(parsedUrl.href, {
      headers: {
        "user-agent": "web-info-fetcher/1.0"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Request failed for ${parsedUrl.href}: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  return {
    url: parsedUrl.href,
    status: response.status,
    title: findTitle(html),
    description: findMeta(html, "description"),
    keywords: findMeta(html, "keywords"),
    ogTitle: findMeta(html, "og:title"),
    ogDescription: findMeta(html, "og:description"),
    ogImage: findMeta(html, "og:image"),
    links: extractLinks(html, parsedUrl.href)
  };
}
