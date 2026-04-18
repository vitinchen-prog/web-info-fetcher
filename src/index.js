const url = process.argv[2];

if (!url) {
  console.log("Usage: npm start -- <url>");
  console.log("Example: npm start -- https://example.com");
  process.exit(1);
}

let parsedUrl;

try {
  parsedUrl = new URL(url);
} catch {
  console.error("Please provide a valid URL, for example: https://example.com");
  process.exit(1);
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .trim();
}

function findTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1].replace(/\s+/g, " ")) : null;
}

function findMeta(html, name) {
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

async function main() {
  console.log(`Fetching: ${parsedUrl.href}`);

  const response = await fetch(parsedUrl.href, {
    headers: {
      "user-agent": "web-info-fetcher/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();
  const result = {
    url: parsedUrl.href,
    status: response.status,
    title: findTitle(html),
    description: findMeta(html, "description"),
    keywords: findMeta(html, "keywords"),
    ogTitle: findMeta(html, "og:title"),
    ogDescription: findMeta(html, "og:description"),
    ogImage: findMeta(html, "og:image")
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
