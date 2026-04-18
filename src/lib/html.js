export function decodeHtml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

export function stripTags(value = "") {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

export function findTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : null;
}

export function findMeta(html, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${escapedName}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escapedName}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+property=["']${escapedName}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escapedName}["'][^>]*>`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return decodeHtml(match[1]);
    }
  }

  return null;
}

export function extractLinks(html, baseUrl, limit = 12) {
  const links = [];
  const seen = new Set();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkPattern.exec(html)) && links.length < limit) {
    try {
      const href = new URL(match[1], baseUrl).href;
      const text = stripTags(match[2]);

      if (!text || seen.has(href)) {
        continue;
      }

      seen.add(href);
      links.push({ text, href });
    } catch {
      // Skip malformed URLs.
    }
  }

  return links;
}
