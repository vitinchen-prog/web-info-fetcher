# Web Info Fetcher

Evidence-first AI weekly reports covering frontier models, platforms and products.
Node.js 18+; install with `npm ci`. No model API or paid calls are required.

## Generate and inspect

```bash
npm run report -- --issue 45
```

Produces a Markdown report, a matching `.md.manifest.json` evidence file and
`reports/latest-report.json`. Generation **never sends email or advances delivered
history**. An insufficient report is still saved for inspection. Its quality status
and source failures are visible in the report, manifest, console and Actions summary.

The current period is Monday–Sunday in **Asia/Shanghai**. Dates after generation time,
unknown dates, out-of-period articles and already delivered events are excluded.
Monday morning can legitimately have too little new evidence; no-news/failed
collection is never replaced with generic commentary and called a finished report.

## Collection and evidence

Sources remain in `config/sources.json`; extraction rules are in
`src/lib/source-rules.js`. The parser filters page navigation, scripts, templates,
hidden elements and off-source URLs. It isolates each article/card, validates real
calendar dates and stores `dateEvidence` and `summaryEvidence`. Dates are not borrowed
from neighboring cards. Tracking URL parameters and fragments are normalized.

A successful HTTP response with no articles is **not** a successful news collection.
Blocked/non-HTML responses, empty extraction, unsupported sources, corrupt browser
caches and stale caches are reported explicitly. X requires an authorized collection
integration; product homepages do not count as news events. Their missing coverage is
shown rather than filled with navigation links. Full article extraction and X API
integration are not implemented.

### Optional logged-in browser collection

```bash
npm run browser:login
npm run collect:browser
npm run collect:browser -- --all
```

Requires local Chrome/Chromium or `CHROME_PATH=/path/to/chrome`. Login remains manual.
Profiles are stored under `.auth/`; collected content under
`data/browser-collections/`. **Do not commit logged-in browser content or profiles.**
Collections use full timestamps and are selected by collection time, not filename.
Default maximum cache age is 72 hours. Legacy records without date evidence do not
become current events simply because they contain a date field. Cache age is checked
again immediately before sending.

## Deduplication, scoring and analysis

Pipeline: collection → evidence validation → event grouping/history → configurable
scoring → source-bound analysis → report and manifest → send-time gate → delivery
history. This separation is inspired by [Horizon](https://github.com/Thysrael/Horizon),
without migrating this project to its Python stack.

- URL, normalized headline and conservative title-similarity matching merge reports
  of the same event while retaining every source. Numeric/model-version and entity
  safeguards avoid obvious false merges. Cross-language paraphrases can still be
  missed. Similar titles are not proof of independent corroboration.
- `config/report-policy.json` controls topic keywords/weights, recency, official-source
  and multi-source weights, minimum score and maximum event count. Scores express
  relevance, **not factual reliability**.
- Analysis quotes only supported titles/excerpts and cites the exact article links.
  Conditional pricing/API, model-evaluation or search/distribution implications expose
  the evidence terms and links that triggered them. Unknown implications stay unknown.
- This is constrained, deterministic analysis, **not full-article deep analysis or
  independent fact-checking**. `analysis.mode="llm"` explicitly downgrades with a
  warning because no LLM provider is implemented, whether or not a key exists. No
  credentials are read into reports and no paid API request is made.

## Quality gate and email

Default send requirements in `config/report-policy.json`:

- At least **3** eligible current events from **2** distinct sources.
- At least **50%** of configured article-capable sources return articles.
- Report age at most **24 hours**, browser evidence age at most **72 hours**.
- Valid evidence dates, unchanged report bytes (SHA-256), valid delivery history,
  no prior delivery of selected events and no uncertain pending attempt.

Missing X/product-homepage coverage is disclosed but not counted as an article
source failure. These default thresholds deliberately prefer withholding a weak
report. Adjust policy explicitly rather than bypassing the gate.

Existing SMTP environment variables and recipient defaults are unchanged. Copy
`.env.example` to `.env`, configure and export it. Never commit credentials.

```bash
# Validation only: no SMTP dependency/credentials required, no history writes.
npm run send -- reports/weekly_ai_report_issue_45_mon_1108.md --dry-run

# Real delivery only after review and with configured SMTP:
npm run send -- reports/weekly_ai_report_issue_45_mon_1108.md
```

Old reports without a matching manifest, modified reports and simulation fixtures
cannot be sent. The report's exact in-memory bytes are used for both body and
attachment. `--history <file>` and `--policy <file>` support explicit local locations.
Missing email dependencies stop before state changes; reinstall with `npm ci`.

Actual delivery acquires a local lock and atomically writes a **pending** attempt
before SMTP. Only acceptance of every configured recipient confirms sent history.
SMTP acceptance is not confirmation of inbox delivery. Partial acceptance, timeout,
crash or uncertainty leaves pending state and **blocks automatic retry**. Do not delete
history to force a retry: reconcile SMTP logs/recipient mailbox first, then preserve
or repair the confirmed event/delivery records. Never edit state while a send runs.
This does not claim exactly-once delivery across SMTP and storage failures.

## Scheduled delivery

The schedule is unchanged: **Monday, Wednesday and Friday at 00:43 UTC
(08:43 Asia/Shanghai)**. The keepalive workflow is unchanged. No repository write
permission, new secret or recipient is required; `actions: read` reads state artifacts.

**First rollout after merge:** manually run **Weekly AI Report** with
`initialize_history=true` and `send=false`. This publishes empty initial delivery
history. Earlier emails are not inferred or marked sent. Do not use initialization
to recover a lost existing history; recover the known state instead.

Subsequent runs restore the latest branch-specific history artifact, enforce quality,
and upload reports/evidence plus confirmed or pending state. Each run/attempt has a
unique history artifact name. State artifacts are retained **90 days** and refreshed
even when quality blocks a new report; report artifacts are retained 30 days.
Keep a separate archive before pausing longer than retention.

Missing/corrupt/expired state fails closed. Restore also inspects workflow attempts
updated after the checkpoint, including older runs that were rerun. If SMTP may have
run after the latest durable state (for example, final artifact upload failed), it
stops for manual reconciliation rather than blindly restoring older state and
resending. API/job metadata failures also stop recovery. The workflow has not been
executed against production as part of this change.

Quality failures are surfaced as failed Actions runs, job summaries and downloadable
artifacts. A separate alert email is intentionally not sent. GitHub's normal workflow
notification settings determine whether you receive a failure notification.

## Offline regression and tests

```bash
npm test
npm run report -- --fixture test/fixtures/report-sources.json \
  --now 2026-11-08T08:00:00Z --issue fixture \
  --history /tmp/fixture-history.json --output-dir /tmp/report-preview
```

Fixtures are clearly synthetic. `--now` is permitted only with `--fixture`.
Simulation manifests cannot be sent, regardless of SMTP credentials. Tests use
fixed inputs, loopback HTTP responses and injected transports; they never send mail.

The suite covers card/date contamination, blocked fetches/timeouts, stale browser
collections, dedup/version safeguards, scoring/evidence constraints, corrupt history,
partial/uncertain SMTP outcomes, report integrity, first-run state initialization,
missing state after reruns and offline CLI output.

## One-page metadata utility

```bash
npm run demo
npm start -- https://example.com
npm run check:sources
```

Browser automation and SMTP remain optional for generation. Install errors do not
silently substitute fabricated news or mark anything sent.
