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

## Browser Collection For Login-Protected Sources

Some required sources block normal script fetching or need login, especially X.

Open Chrome and log in:

```bash
npm run browser:login
```

By default this opens X. Log in to X in the browser window. You can also visit OpenAI News, Search Engine Land, ChatGPT, Gemini, and Perplexity in the same browser session if they ask for consent or login.

The collector looks for a local Chrome/Chromium automatically on macOS, Windows, and Linux. If it cannot find one, set `CHROME_PATH` to your browser binary:

```bash
CHROME_PATH="/path/to/chrome" npm run collect:browser
```

When you are done, return to the terminal and press Enter. The local browser profile is saved in `.auth/browser-profile`, which is ignored by Git.

Collect browser-only sources:

```bash
npm run collect:browser
```

Collect every configured source with the browser:

```bash
npm run collect:browser -- --all
```

Browser collection output is written to `data/browser-collections/`, which is also ignored by Git because it may contain logged-in page text.

## Generate A Weekly AI Report Draft

Check source crawl status first:

```bash
npm run check:sources
```

```bash
npm run report -- --issue 1
```

If you ran `npm run collect:browser` first, the generator automatically reads the most recent file in `data/browser-collections/` and reuses the logged-in content (title, description, links) for matching sources. Those sources are marked `浏览器已采集` instead of `需人工登录核验`, and the report's data-source line shows how many sources used collected content. Without a collection file, login-protected sources stay as placeholders.

### Article Extraction

For supported sources, the generator parses the listing/blog page and pulls out the actual article headlines and URLs instead of only the homepage title. The summary table shows a `抓到文章数` column, and each layer lists the parsed headlines under `本周文章（自动抓取，需人工复核）`.

Where possible the engine also extracts each article's **publish date** (from `<time datetime>`, the URL, or ISO / Chinese `YYYY年M月D日` / English `Month D, YYYY` text) and a short **summary** (the anchor `title` attribute or a nearby paragraph). Articles are sorted with the current week first, items inside the covered week are tagged `🆕本周`, undated items are marked `日期待确认`, and the data-source line reports how many dated articles fall inside the week.

Extraction rules are declarative and live in `src/lib/source-rules.js`, keyed by source name. Each rule is a set of URL patterns (e.g. OpenAI posts under `/index/`, 36Kr under `/p/<id>`). To support a new site or fix a changed URL structure, add or adjust a rule there — no per-site parser code is needed. The shared engine is in `src/lib/extract-articles.js`.

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

## Scheduled Delivery (GitHub Actions)

`.github/workflows/weekly-report.yml` generates a report draft and emails it automatically.

- **Schedule:** every **Monday, Wednesday, and Friday** at `00:43 UTC` (08:43 Asia/Shanghai). The cron uses minute `43` at `00:xx UTC` on purpose — GitHub delays scheduled jobs most at the top of the hour and during peak US daytime, so this lands in a low-load window.
- **Issue number:** defaults to the current ISO week number; override it when running manually.
- **Output:** the report is uploaded as a workflow artifact and emailed.

### Required setup

1. **Merge this workflow into the default branch (`main`).** GitHub only runs scheduled workflows from the default branch, so the cron will not fire until then. You can still test it from any branch with the **Run workflow** button (`workflow_dispatch`).
2. Add the SMTP settings as **repository secrets** (Settings → Secrets and variables → Actions):

   | Secret | Required | Default if unset |
   | --- | --- | --- |
   | `SMTP_HOST` | yes | — |
   | `SMTP_USER` | yes | — |
   | `SMTP_PASS` | yes (Gmail App Password) | — |
   | `SMTP_PORT` | no | `465` |
   | `SMTP_SECURE` | no | `true` |
   | `REPORT_FROM` | no | `SMTP_USER` |
   | `REPORT_TO` | no | `vitinchen@gmail.com` |
   | `REPORT_SUBJECT` | no | `本周 AI 资讯周报` |

> The scheduled run fetches sources over the network, so direct-fetch sources are collected live. Login-only sources (X, etc.) remain placeholders because the CI runner has no logged-in browser session — run `npm run collect:browser` locally and commit/share that data if you need them included.

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
2. Extend the article-extraction rules in `src/lib/source-rules.js` to cover more sites and capture publish dates/summaries.
3. Add a review step that turns the draft into a polished final report.
4. Schedule weekly generation and delivery.

## Tests

```bash
npm test
```

This runs the Node built-in test runner against `test/`, including the article-extraction rules.
