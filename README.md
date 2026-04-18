# Web Info Fetcher

A beginner-friendly command-line tool that fetches basic information from a web page.

It can read:

- Page title
- Meta description
- Meta keywords
- Open Graph title
- Open Graph description
- Open Graph image

## Requirements

- Node.js 18 or newer

Your computer already has Node.js installed.

## Usage

Run the demo:

```bash
npm run demo
```

Fetch a page:

```bash
npm start -- https://example.com
```

## Example Output

```json
{
  "url": "https://example.com/",
  "status": 200,
  "title": "Example Domain",
  "description": null,
  "keywords": null,
  "ogTitle": null,
  "ogDescription": null,
  "ogImage": null
}
```

## What To Try Next

1. Save the result to a file.
2. Fetch multiple URLs from a list.
3. Build a small web page for entering URLs.
4. Add tests.
