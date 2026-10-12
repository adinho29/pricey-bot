# Stock Discord Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stateless Node CLI, run by a GitHub Actions cron, that posts ETF prices from Yahoo Finance into a Discord channel via an incoming webhook at configured Bucharest clock times on weekdays.

**Architecture:** Six small modules behind pure functions where possible (`config`, `schedule`, `quotes`, `format`, `discord`, `app`) wired by a three-line `main.ts`. All I/O (file, env, HTTP, Yahoo client, clock, sleep) is injected so every module is unit-tested without network.

**Tech Stack:** Node 22.9+ (ESM, built-in `fetch`, `Intl`), TypeScript 5.9 (`tsc` → `dist/`), Vitest 5, `yahoo-finance2` v4. No other runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-12-stock-discord-bot-design.md`

## Global Constraints

- Node `>=22.9`; `"type": "module"`; TS `NodeNext`, `ES2022`, `strict`; intra-project imports use `.js` suffix.
- Runtime dependency: only `yahoo-finance2`. Dev: `typescript`, `vitest`, `@types/node`.
- The only secret is `DISCORD_WEBHOOK_URL`; never in `config.json` or git; its token never in logs.
- Message format exactly as spec §8; exit codes per spec §10; cron `7 5-16 * * *`; slot window `[slot, slot+60min)`.
- No tests touch the network.

## Review Focus

1. Malformed `config.json` must exit 1 with a message naming the field. → Task 2.
2. `DISCORD_WEBHOOK_URL` pasted without `https://`, or pointing at a non-Discord host, must be a clear `ConfigError`, and the token must never appear in any error text. → Tasks 2 and 6.
3. Incomplete Yahoo quotes (missing currency or time) render `n/a`; fewer quotes than requested still yield one line per ticker in config order. → Task 4.
4. Runs at 11:00 and 11:59 send; 12:00 does not. → Task 3.
5. A message longer than 2000 characters must still arrive, split at line boundaries, in order. → Task 6.

---

### Task 1: Scaffold
Files: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `config.json`, `.github/workflows/{notify,ci}.yml`.
- [ ] Write files per spec §5, §11, §12; `npm install`; `npx tsc --version` → 5.9.x; `npx vitest --version` → 5.x. Commit.

### Task 2: Config (`src/config.ts`, `test/config.test.ts`)
Produces: `Config`, `Credentials = { webhookUrl }`, `ConfigError`, `parseConfig(raw)`, `loadConfig(path?)`, `loadCredentials(env?)`.
- [ ] Tests: defaults; each rule names its field; bad JSON / missing file name the path; `DISCORD_WEBHOOK_URL` missing, blank, non-https, wrong host, wrong path rejected; `discord.com` and `discordapp.com` accepted; value trimmed.
- [ ] RED → implement (`Intl` timezone probe, `^([01]\d|2[0-3]):[0-5]\d$`, `new URL` + host set + `/api/webhooks/<id>/<token>` regex) → GREEN → commit.

### Task 3: Schedule (`src/schedule.ts`, `test/schedule.test.ts`)
Produces: `toLocalTime(now, tz) -> {weekday, hour, minute}`, `shouldSend(now, cfg) -> {send, reason}`.
- [ ] Tests per spec §13 → RED → implement with `formatToParts` and `hourCycle: "h23"` → GREEN → commit.

### Task 4: Quotes (`src/quotes.ts`, `test/quotes.test.ts`)
Produces: `Quote`, `RawQuote`, `QuoteClient`, `FetchQuotesDeps`, `fetchQuotes(symbols, deps?)`, `fetchChartQuote(symbol, fetchFn)`, `createYahooClient()`.
- [ ] Tests per spec §13 with fake client/fetch/sleep → RED → implement (3 attempts, backoff `[2000, 4000]`, normalise requiring price+currency+time, chart fallback with browser UA, throw when all null) → GREEN → commit.

### Task 5: Format (`src/format.ts`, `test/format.test.ts`)
Produces: `formatDateTime`, `weekdayAbbrev`, `cityFromTimezone`, `buildMessage(quotes, now, cfg)`.
- [ ] Tests per spec §13 → RED → implement → GREEN → commit.

### Task 6: Discord (`src/discord.ts`, `test/discord.test.ts`)
Produces: `SendError`, `DISCORD_MAX_CONTENT = 2000`, `splitContent(text, limit?)`, `sendToChannel(text, creds, fetchFn?) -> Promise<string>`.
- [ ] Tests: POST to `${webhookUrl}?wait=true` with JSON `{content}`; returns `id`; 204 accepted; non-2xx → `SendError{status}` with excerpt; token redacted in thrown-URL and body-echo cases; network error wrapped; >2000 chars split in order, each chunk ≤ 2000, joined equals original, last id returned; `splitContent` fits / line boundary / hard split.
- [ ] RED → implement → GREEN → commit.

### Task 7: App and entry (`src/app.ts`, `src/main.ts`, `test/app.test.ts`)
Produces: `AppDeps`, `run(argv, deps?) -> Promise<number>`.
- [ ] Tests: skip outside slot; send inside slot with exact message; `--force`; `--dry-run` without credentials; config error → 1; credentials error → 1 before quotes; quotes error → 1; send error → 1; partial quotes still send and log; unknown argument → 1.
- [ ] RED → implement → GREEN → `npm run build` → `npm run dry-run` prints a live message → commit.

### Task 8: Project contracts and README (`test/project.test.ts`, `README.md`)
- [ ] Tests: cron day-of-week is `*`; `engines.node` floor ≥ 22.9 while scripts use `--env-file-if-exists`.
- [ ] README: what it does with sample, how it works, one-time Discord + GitHub setup, changing config, commands, troubleshooting, cost, layout. Commit.

### Task 9: Final verification
- [ ] `npm test` green, `npm run build` clean, `npm run dry-run` live. Whole-tree review against the spec; fix findings test-first; commit.
