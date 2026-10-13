# Stock Discord Bot – Design Spec

Date: 2026-10-12

## 1. Purpose

A zero-cost bot that posts the current price of a configurable list of ETFs/stocks
into a Discord channel at fixed times on weekdays. Each run produces one message,
one line per ticker, in the form `TICKER - PRICE CUR - DD.MM.YYYY HH:mm`.

### Success criteria

- Runs unattended for weeks with no paid service, no credit card, no server to maintain.
- Posts at 11:00 and 15:00 Europe/Bucharest on weekdays (both times configurable),
  correct across daylight-saving changes.
- Tickers, send times, weekend behaviour and timezone are changed by editing one JSON
  file and pushing.
- A failed run is visible without logging in anywhere (GitHub's failure email).

## 2. Decisions

| Decision | Choice | Why |
|---|---|---|
| Notification channel | Discord incoming webhook | Official, free, no bot account or OAuth: one HTTPS POST to a URL bound to a channel. Native group chat. Alternatives considered: Telegram Bot API (equally good, needs a bot token and chat-id discovery), ntfy.sh push (no chat thread), email (not a chat). WhatsApp was rejected: every free route depends on an unofficial WhatsApp Web session, and the official API cannot post into groups. |
| Price data | Yahoo Finance via `yahoo-finance2` (Node), raw chart endpoint as fallback | Only free source covering Xetra ETFs (and US, London, Amsterdam, Bucharest) with intraday prices and currency, batched in one call. Alpha Vantage is 25 req/day and end-of-day only on free. |
| Runtime | GitHub Actions workflow, started by cron-job.org through the workflow-dispatch API | Free, deploy by `git push`, secrets built in, per-run logs, failure emails. GitHub's own `schedule` trigger never dispatched a run for this repository (see §6), a widely reported 2026 problem; cron-job.org is a free scheduler with timezone support. |
| Stack | Node 22, TypeScript, Vitest | `yahoo-finance2` is Node-only; Node 22 is installed locally. No frameworks. |
| Schedule model | cron-job.org wakes the workflow at each send time in Europe/Bucharest, every day; the script still enforces `sendTimes`, the 60-minute window and `weekdaysOnly` | The script's check is the safety net against a misfiring, duplicated or delayed trigger; `config.json` stays authoritative for weekends and for what may be posted, cron-job.org holds the wake-up times. |
| Message granularity | One message per run containing all tickers | One notification per slot, easy to scan. |

## 3. Non-goals

- No persistent state, no duplicate-send protection across runs.
- No exchange holiday calendar. The message shows each quote's own timestamp, so a stale price is visible.
- No price change / percentage, charts, alerts or thresholds.
- No multiple channels or per-ticker schedules.
- No "every X minutes" polling. The schedule is a list of daily clock times.

## 4. Architecture

A single stateless CLI (`node dist/main.js`). One run does:

```
load config.json + env secret
  -> schedule.shouldSend(now, config)        skip? -> log "skipped: <reason>", exit 0
  -> quotes.fetchQuotes(tickers)              all failed? -> exit 1
  -> format.buildMessage(quotes, now, config)
  -> discord.sendToChannel(text)              failed? -> exit 1
  -> log "sent", exit 0
```

### Modules (`src/`)

| File | Responsibility | Depends on |
|---|---|---|
| `config.ts` | Load and validate `config.json` and the `DISCORD_WEBHOOK_URL` env var. Throws a descriptive error naming the missing/invalid field. | fs, process.env |
| `schedule.ts` | Pure. `shouldSend(now: Date, cfg) -> { send: boolean; reason: string }`. | Intl |
| `quotes.ts` | `fetchQuotes(symbols) -> Quote[]`. Batched `yahoo-finance2` call with retry, per-symbol fallback to the Yahoo chart endpoint, `null` price on failure. | yahoo-finance2, fetch |
| `format.ts` | Pure. `buildMessage(quotes, now, cfg) -> string`. | Intl |
| `discord.ts` | `sendToChannel(text, creds)`. POSTs to the webhook, splitting at Discord's 2000-character limit. Throws on non-2xx. | fetch |
| `app.ts` | `run(argv, deps) -> exit code`. Orchestration, CLI flags `--force` and `--dry-run`, logging. All I/O injectable. | all above |
| `main.ts` | Three-line entry: `process.exitCode = await run(process.argv.slice(2))`. | app |

### Types

```ts
type Config = {
  timezone: string;          // IANA, e.g. "Europe/Bucharest"
  sendTimes: string[];       // "HH:mm", 24h, local to timezone
  weekdaysOnly: boolean;
  tickers: string[];         // Yahoo symbols, e.g. "VWCE.DE"
  priceDecimals: number;     // default 2
  title: string;             // default "ETF prices"
};

type Credentials = { webhookUrl: string };   // DISCORD_WEBHOOK_URL

type Quote = {
  symbol: string;
  price: number | null;      // null = fetch failed
  currency: string | null;
  time: Date | null;         // exchange quote time
};
```

## 5. Configuration and secrets

`config.json` (committed):

```json
{
  "timezone": "Europe/Bucharest",
  "sendTimes": ["11:00", "15:00"],
  "weekdaysOnly": true,
  "tickers": ["VWCE.DE", "AVWS.DE", "VGLA.DE"],
  "priceDecimals": 2,
  "title": "ETF prices"
}
```

Validation rules: `timezone` must be accepted by `Intl.DateTimeFormat`; each `sendTimes`
entry matches `^([01]\d|2[0-3]):[0-5]\d$`; `tickers` is a non-empty array of non-empty
strings; `priceDecimals` is an integer 0-6. `priceDecimals` and `title` are optional and
default to `2` and `"ETF prices"`.

Secret (never in the repo): `DISCORD_WEBHOOK_URL`. It must be an `https:` URL on
`discord.com` or `discordapp.com` (or their `ptb.`/`canary.` hosts) with path exactly
`/api/webhooks/<id>/<token>`; a trailing slash is stripped, a query string such as
`thread_id` is kept, and anything else (including the `/slack` and `/github` variants) is
a `ConfigError` naming the variable. The
last path segment is the webhook's secret token and must never appear in logs.
Locally the secret comes from a git-ignored `.env` loaded with Node's
`--env-file-if-exists=.env`; on GitHub it is a repository secret mapped to the env var.
`.env.example` shows the name with a placeholder value.

## 6. Scheduling

- Trigger: cron-job.org (free plan) sends
  `POST https://api.github.com/repos/<owner>/<repo>/actions/workflows/notify.yml/dispatches`
  with body `{"ref":"main"}` at each configured send time in Europe/Bucharest (default
  jobs: 11:00 and 15:00; 19:30), every day, authenticated with a fine-grained GitHub token
  limited to this repository with Actions read/write.
- The workflow has no `schedule:` trigger. On 2026-10-13 GitHub's scheduler dispatched
  zero runs for this repository across a whole morning, private and public, with hourly
  and every-20-minutes cron lines and two cron-line commits, while `workflow_dispatch`
  worked every time. GitHub Community threads #185355, #200282, #202602 and #203822
  report the same in 2026 with no official fix. A `schedule:` trigger that woke up later
  would post a second time inside a slot, so it is removed rather than left as a backup.
- `shouldSend(now, cfg)` runs unchanged on every dispatched run:
  1. Convert `now` to local wall-clock in `cfg.timezone` via `Intl.DateTimeFormat`.
  2. If `weekdaysOnly` and local weekday is Saturday or Sunday -> `{send:false, reason:"weekend"}`.
  3. For each slot in `sendTimes`: send if `slotMinutes <= nowMinutes < slotMinutes + 60`
     (minutes since local midnight; windows do not wrap past midnight).
     -> `{send:true, reason:"slot 11:00"}`.
  4. Otherwise `{send:false, reason:"10:07 is not within 60 min after any send time"}`.
- The script's check is the safety net: a trigger that fires at the wrong time, twice, or
  on a weekend produces a "skipped" run, never a wrong post. A trigger delayed by more
  than 60 minutes skips that slot for the day; accepted.
- Changing send times means editing `sendTimes` in `config.json` and the cron-job.org
  schedule to match. `weekdaysOnly` lives only in the config.
- `--force` bypasses `shouldSend`. `--dry-run` implies `--force`. The workflow's manual
  trigger exposes `force` as a boolean input; cron-job.org passes no inputs.

## 7. Quote fetching

Primary: `yahoo-finance2` v4 (`new YahooFinance({ suppressNotices: ["yahooSurvey"],
versionCheck: false }).quote(symbols)`), one batched call. Fields used: `symbol`,
`regularMarketPrice`, `currency`, `regularMarketTime`.

Retry: up to 3 attempts with 2 s, 4 s backoff on any thrown error.

Fallback (per symbol, only for symbols still missing or incomplete after the attempts):
`GET https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1d`
with a desktop browser `User-Agent`. Read `chart.result[0].meta.regularMarketPrice`,
`.currency`, `.regularMarketTime` (unix seconds). Verified working on 2026-10-12 for all
three default tickers without cookies or crumb.

Result: one `Quote` per configured ticker, in config order. A quote is complete only when
`price`, `currency` and `time` are all present; anything else is normalised to all three
being `null`. If every symbol is `null`, `fetchQuotes` throws.

## 8. Message format

```
ETF prices - Mon 12.10.2026 15:07 Bucharest
VWCE.DE - 173.24 EUR - 12.10.2026 14:51
AVWS.DE - 25.34 EUR - 12.10.2026 14:50
VGLA.DE - n/a
```

- Header: `<title> - <Www DD.MM.YYYY HH:mm> <city>` where the time is the run time in
  `cfg.timezone` and `<city>` is the last path segment of the IANA zone with `_` -> space.
  Weekday abbreviation in English.
- Line: `<symbol> - <price> <currency> - <DD.MM.YYYY HH:mm>` with the quote's own time
  converted to `cfg.timezone`, price via `toFixed(priceDecimals)` with `.` separator.
- Failed ticker: `<symbol> - n/a`.
- Lines joined with `\n`, no trailing newline, no emoji, no Discord markdown.

## 9. Discord delivery

```
POST {webhookUrl}?wait=true
Content-Type: application/json
{ "content": "<text>" }
```

- `wait=true` makes Discord return the created message (HTTP 200 with `id`) instead of
  204; the id is logged. A 204 is still treated as success.
- Discord rejects content over 2000 characters. `sendToChannel` splits the text at line
  boundaries into chunks of at most 2000 characters and posts them in order; a single
  line longer than the limit is hard-split. It resolves with the last message id.
- Non-2xx or network error throws `SendError` with the status and a 300-character body
  excerpt; for network errors the message includes `err.cause` (e.g. `ENOTFOUND`), since
  Node's fetch itself only says "fetch failed". The webhook token is replaced by `[redacted]` in every error message, because
  Node's fetch includes the URL in some error texts.
- No retry on send (a retry could double-post). Discord's rate limits are irrelevant at
  two posts per day.

## 10. Error handling and exit codes

| Situation | Behaviour | Exit |
|---|---|---|
| Not a send slot | log `skipped: <reason>` | 0 |
| Config/env invalid | log error naming the field | 1 |
| Some tickers failed | send message with `n/a` lines, log which failed | 0 |
| All tickers failed | log error, do not send | 1 |
| Discord send failed | log status and body excerpt | 1 |
| `--dry-run` | print message to stdout instead of sending; no secret needed | 0 |
| Unknown CLI argument | log error, send nothing | 1 |

Credentials are loaded before quotes are fetched, so a missing secret fails fast without
hitting Yahoo. Logging is plain `console.log` / `console.error` lines, one per step, with
ISO timestamps.

## 11. GitHub Actions workflows

`notify.yml`: `workflow_dispatch` only, with boolean input `force`; `permissions:
contents: read`; `concurrency: notify`. Steps: checkout; setup-node 22 with npm cache;
`npm ci`; `npm run build`; `node dist/main.js` plus `--force` when the input is true,
with `DISCORD_WEBHOOK_URL` mapped from secrets. Dispatches from cron-job.org arrive
through the REST API with no inputs. No `schedule:` trigger (see §6) and therefore no
keepalive step: GitHub's 60-day auto-disable applies to scheduled workflows only.

`ci.yml`: on push to `main` and on pull requests: `npm ci`, `npm test`, `npm run build`.

## 12. Repository layout and stack

```
stock-discord-bot/
  .github/workflows/{notify,ci}.yml
  docs/superpowers/{specs,plans}/
  src/{config,schedule,quotes,format,discord,app,main}.ts
  test/{config,schedule,quotes,format,discord,app,project}.test.ts
  config.json
  .env.example
  .gitignore            (node_modules, dist, .env, .superpowers)
  package.json          scripts: build, test, send, dry-run; engines.node >=22.9
  tsconfig.json         ES2022, NodeNext modules, strict, outDir dist
  README.md
```

Dependencies: runtime `yahoo-finance2`; dev `typescript`, `vitest`, `@types/node`.
No other packages. Dates are formatted with `Intl`, HTTP with built-in `fetch`.

## 13. Testing

Unit tests with Vitest, injecting `fetch`, the Yahoo client, the clock and sleep; no
network in tests.

- `schedule.test.ts`: summer and winter offsets, exact slot minute, last minute of the
  window, window closed, weekend skip, weekend allowed, half-hour slot, no midnight wrap.
- `format.test.ts`: exact expected string; `n/a` line; `priceDecimals`; title; city
  derivation; weekday abbreviation; midnight crossing in winter.
- `quotes.test.ts`: config-order mapping; missing symbol via fallback with browser UA;
  retry backoff 2 s / 4 s; fallback for all after three failures; non-200 fallback ->
  null; incomplete quote -> fallback; all null -> throws; chart meta parsing.
- `discord.test.ts`: POST shape with `wait=true` and JSON content; 204 accepted; non-2xx
  -> `SendError` with status and excerpt; token never in error text; network failure
  wrapped; content over 2000 chars split at line boundaries in order; `splitContent` edge
  cases.
- `config.test.ts`: defaults; every validation rule names its field; invalid JSON and
  missing file name the path; `DISCORD_WEBHOOK_URL` missing, empty, non-https, non-Discord
  host, non-webhook path all rejected; valid hosts accepted.
- `app.test.ts`: skip outside slot; send inside slot with the exact message; `--force`;
  `--dry-run` without credentials; config error -> 1; credentials error -> 1 before
  quotes; all quotes failed -> 1; send failed -> 1; partial quotes still send; unknown
  argument -> 1.
- `project.test.ts`: the cron's day-of-week field is `*`; `engines.node` floor covers
  `--env-file-if-exists`.

Manual verification: `npm run dry-run` prints a live message; one `workflow_dispatch`
run with `force=true` posts to the channel.

## 14. One-time setup (performed by the user, documented in README)

1. In Discord, create or pick the channel. Channel -> Edit Channel -> Integrations ->
   Webhooks -> New Webhook -> Copy Webhook URL.
2. Locally: copy `.env.example` to `.env`, paste the URL, `npm install`, `npm run build`,
   `npm run dry-run`, then `npm run send -- --force` once to see it in the channel.
3. Create a GitHub repo (visibility irrelevant), push `main`, add the secret
   `DISCORD_WEBHOOK_URL`, run the workflow manually once with `force`.
4. Create a fine-grained GitHub token: only this repository, permission Actions: read and
   write, longest expiration offered.
5. On cron-job.org create one job per distinct minute-of-hour (default: 11:00+15:00 and
   19:30), timezone Europe/Bucharest, every day, POST to the dispatch URL with headers
   `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`,
   `X-GitHub-Api-Version: 2026-03-10`, `Content-Type: application/json`, body
   `{"ref":"main"}`. Enable failure notifications. Use the job's test run to confirm a
   `workflow_dispatch` run appears under Actions.

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Webhook deleted or regenerated in Discord | Send fails with 404 `Unknown Webhook`; GitHub emails; paste the new URL into the secret. |
| Webhook URL leaks (anyone holding it can post to the channel) | Stored only as a GitHub secret and a git-ignored `.env`; redacted from error output; regenerate in Discord if exposed. |
| Yahoo breaks the library (historically 1-3 times/year) | Retry, then raw chart endpoint fallback; `n/a` lines keep the rest flowing; failing run emails you. |
| Yahoo rate-limits GitHub's datacenter IPs | Two batched calls per day is far below observed thresholds; fallback uses a browser UA. |
| cron-job.org fails to call GitHub (outage, expired or revoked token) | cron-job.org failure notifications; HTTP 401 means a new token is needed in both jobs. GitHub's own failure email does not cover this case. |
| GitHub queues the dispatched run late | 60-minute slot window; the header shows the real send time. |
| Send times drift apart between `config.json` and cron-job.org | A mismatch only ever yields a "skipped" run, never a wrong post; README states that both must be edited together. |
| Message grows past 2000 characters with many tickers | Automatic line-boundary splitting into several posts. |

## 16. Research summary (2026-10-12)

Notification channels usable from a stateless cron, free: Discord webhook (chosen),
Telegram Bot API, ntfy.sh topics, Slack incoming webhook, email via Gmail app password or
Brevo free tier. Signal needs a persistent registered device; WhatsApp has no official
group posting and its free bridges rely on unofficial sessions held by third parties.

GitHub Actions `schedule` reliability: zero dispatched runs for this repo on 2026-10-13 under
every variant tried; many 2026 community reports of the same for new or private repos, no
official resolution. External trigger via `workflow_dispatch` chosen; alternatives were a
Cloudflare Worker cron, Windows Task Scheduler on the user's PC, or waiting.

Price sources: Yahoo unofficial (no key, batched, EU + BVB, ~15 min delay),
Alpha Vantage (25/day, EOD on free), Finnhub / Twelve Data (US only on free),
FMP / Polygon (US, EOD), Stooq (dead for scripts), EODHD (20/day), Marketstack (100/month).

Key sources:
- https://discord.com/developers/docs/resources/webhook#execute-webhook
- https://github.com/gadicc/yahoo-finance2/releases
- https://www.alphavantage.co/support/
- https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#schedule
- https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
- https://github.com/orgs/community/discussions/185355
- https://github.com/orgs/community/discussions/202602
- https://github.com/orgs/community/discussions/203822
- https://github.com/orgs/community/discussions/200282
- https://docs.cron-job.org/
