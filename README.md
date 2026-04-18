# Web Info Fetcher

A weekly AI report generator that scans required sources, drafts a Markdown report, and can email the result.

The long-term goal is to generate a weekly AI intelligence report for `vitinchen@gmail.com` using this structure:

- Extension layer: global frontier AI technology
- Platform layer: global AI platform trends
- Product layer: product changes and competitive dynamics

## Requirements

- Node.js 18 or newer

Your computer already has Node.js installed.

Install dependencies:

```bash
npm install
```

## Fetch One Page

Run the demo:

```bash
npm run demo
```

Fetch a page:

```bash
npm start -- https://example.com
```

## Generate A Weekly AI Report Draft

Check source crawl status first:

```bash
npm run check:sources
```

```bash
npm run report -- --issue 1
```

This writes a Markdown file to `reports/` using this naming pattern:

```text
weekly_ai_report_issue_N_mon_MMDD.md
```

The generator scans the mandatory source list in `config/sources.json`:

- X / Twitter AI search and key AI accounts
- OpenAI News
- Google DeepMind Blog
- Anthropic News
- Search Engine Land
- 36Kr
- Huxiu
- Major model product websites

Important note: X usually requires login or official API access for reliable collection. The generated report marks X sources as manual-review-required so the final report does not pretend to cite tweets that were not actually collected.

## Send Email

Copy the example environment file and fill in your SMTP settings:

```bash
cp .env.example .env
```

For Gmail, create an App Password in your Google account security settings, then use it as `SMTP_PASS`.

Export the variables:

```bash
set -a
source .env
set +a
```

Send a report:

```bash
npm run send -- reports/weekly_ai_report_issue_1_mon_MMDD.md
```

## Page Metadata Example

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

1. Add X API collection or browser-assisted X collection.
2. Add source-specific parsers for official blogs and media sites.
3. Add a review step that turns the draft into a polished final report.
4. Schedule weekly generation and delivery.
