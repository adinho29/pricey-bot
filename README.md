# pricey-bot

Posts the current price of your ETFs/stocks into a Discord channel at fixed times on
weekdays. Runs for free on GitHub Actions, is woken up by cron-job.org, reads prices
from Yahoo Finance and posts through a Discord incoming webhook. No bot account, no
server, no paid service.

```
ETF prices - Mon 12.10.2026 15:01 Bucharest
VWCE.DE - 173.24 EUR - 12.10.2026 14:46
AVWS.DE - 25.34 EUR - 12.10.2026 14:45
VGLA.DE - 4.46 EUR - 12.10.2026 14:45
```

The header shows when the message was sent. Each line shows the quote's own time, so a
delayed or stale price is visible (European exchanges are ~15 minutes delayed on Yahoo).

## How it works

1. cron-job.org, a free scheduler, calls GitHub's workflow-dispatch API at each send
   time in your timezone (11:00, 15:00 and 19:30 Europe/Bucharest), every day.
2. GitHub starts the `notify` workflow within a minute or so. The script converts the
   current time to your timezone (`config.json`), skips weekends when `weekdaysOnly` is
   true, and posts only when it is within 60 minutes after one of your `sendTimes`. A
   trigger at the wrong time, or twice, can therefore never produce a wrong post.
3. It fetches all tickers in one Yahoo Finance call (three attempts, then a fallback to
   Yahoo's public chart endpoint per symbol), builds one message and posts it to the
   channel through the webhook.
4. If every price fails, or the Discord post fails, the job exits non-zero and GitHub
   emails you. If only some fail, those lines read `n/a` and the rest still go out.
   cron-job.org can separately email you when its call to GitHub fails, for example
   when the token has expired.

**Why an external scheduler?** GitHub Actions has its own `schedule` trigger, but for
this repository GitHub never dispatched a single scheduled run, public or private, with
several cron variants, while manual runs worked every time. This is a widely reported
GitHub problem in 2026 with no official fix. The workflow therefore has no `schedule`
trigger at all; if it had one and GitHub's scheduler woke up later, it would post a
second time in the same slot.

## One-time setup

You need a GitHub account, a Discord server where you can manage a channel, a free
cron-job.org account, and Node 22.9 or newer on your machine for the local steps. No
credit card anywhere.

### 1. Create the webhook in Discord

1. Create a server (or use one you manage) and the channel that should receive prices.
   Invite the people who should see them.
2. Hover the channel, click the gear (*Edit Channel*) → *Integrations* → *Webhooks* →
   *New Webhook*. Give it a name such as `ETF prices`, make sure the right channel is
   selected, then *Copy Webhook URL*.

Treat that URL like a password: anyone holding it can post to the channel.

### 2. Check the message locally

```bash
git clone https://github.com/adinho29/pricey-bot.git
cd pricey-bot
npm install
cp .env.example .env        # paste the webhook URL into .env
npm run build
npm run dry-run             # prints the message, sends nothing, needs no webhook
npm run send -- --force     # posts one real message to the channel right now
```

### 3. Deploy to GitHub Actions

1. Create a GitHub repository (public or private, it makes no difference to the
   dispatch trigger; the webhook stays secret either way) and push this code to `main`.
2. In the repo: *Settings → Secrets and variables → Actions → New repository secret*.
   Name: `DISCORD_WEBHOOK_URL`. Value: the webhook URL.
3. *Actions → notify → Run workflow*, tick **force**, run. The message appears in the
   channel within a minute or two.

### 4. Create a GitHub token for the scheduler

The scheduler needs permission to start the workflow, nothing else.

1. GitHub, top-right avatar → *Settings* → *Developer settings* → *Personal access
   tokens* → *Fine-grained tokens* → *Generate new token*.
2. Name `pricey-bot scheduler`. Expiration: the longest offered; note the date, you will
   repeat this step when it expires.
3. *Repository access*: *Only select repositories* → `pricey-bot`.
4. *Permissions → Repository permissions → Actions*: **Read and write**. Leave the rest.
5. Generate and copy the token now; GitHub shows it only once.

### 5. Create the cron-job.org jobs

Sign up at https://cron-job.org (free). Create one job per distinct minute of the hour;
with the default times that is two jobs.

Job "pricey-bot 11:00 and 15:00":

| Setting | Value |
|---|---|
| URL | `https://api.github.com/repos/adinho29/pricey-bot/actions/workflows/notify.yml/dispatches` |
| Schedule | *Custom*. Timezone `Europe/Bucharest`. Days: every day. Hours: `11` and `15`. Minutes: `0`. |
| Advanced → Request method | `POST` |
| Advanced → Headers | `Authorization: Bearer <your token>` <br> `Accept: application/vnd.github+json` <br> `X-GitHub-Api-Version: 2022-11-28` <br> `Content-Type: application/json` |
| Advanced → Request body | `{"ref":"main"}` |

Job "pricey-bot 19:30": identical, except Hours `19` and Minutes `30`.

GitHub answers `204 No Content` on success, which cron-job.org shows as a green
execution. Turn on failure notifications in your cron-job.org account settings so an
expired token or a GitHub outage reaches your inbox.

To test the chain, use the job's test or "run now" button: a run with event
`workflow_dispatch` appears under *Actions* within a minute. Outside a send window it
logs `skipped`, which is the expected proof that the trigger works end to end.

## Changing tickers, times, weekends or timezone

Tickers, `weekdaysOnly`, `priceDecimals` and `title` live only in `config.json`: edit,
commit, push.

```json
{
  "timezone": "Europe/Bucharest",
  "sendTimes": ["11:00", "15:00", "19:30"],
  "weekdaysOnly": true,
  "tickers": ["VWCE.DE", "AVWS.DE", "VGLA.DE"],
  "priceDecimals": 2,
  "title": "ETF prices"
}
```

Send times live in two places and must match: `sendTimes` here says what the script may
post, and the cron-job.org schedule says when GitHub is woken up. If you add `17:00`
here, add hour `17` to the cron-job.org job as well. The same goes for `timezone`.
Posts land about one minute after the configured time, the time it takes GitHub to
start the job.

Tickers are Yahoo Finance symbols. Search on https://finance.yahoo.com to find them.
Common suffixes: `.DE` Xetra, `.AS` Amsterdam, `.L` London, `.MI` Milan, `.PA` Paris,
`.RO` Bucharest; US symbols have no suffix (`VOO`, `AAPL`).

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests (no network) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dry-run` | Print the message that would be sent now; no webhook needed |
| `npm run send` | Send if the current time is a send slot (what the workflow runs) |
| `npm run send -- --force` | Send now regardless of the schedule |

Locally, the webhook URL is read from a git-ignored `.env` file. The notice
`.env not found. Continuing without it.` is harmless when you have not created one.

## Troubleshooting

- **No run appeared at a send time.** Check the execution history of the cron-job.org
  job first. A red execution with HTTP 401 means the GitHub token expired or was
  revoked: create a new one (setup step 4) and update the `Authorization` header in
  both jobs. HTTP 404 means the URL is wrong, the repo was renamed, or the token has no
  access to it. HTTP 422 means the `ref` is wrong. A green execution with no run under
  *Actions* is a GitHub-side delay; wait a few minutes.
- **A line shows `n/a`.** Yahoo had no complete quote for that symbol after the attempts
  and the fallback. Check the symbol on finance.yahoo.com. If it persists for all
  symbols, Yahoo changed something: run `npm update yahoo-finance2`, rebuild, push.
- **The job failed and GitHub emailed me.** Open the run log under *Actions*. The last
  `ERROR` line names the cause: a config field, the missing secret, all quotes failed, or
  the Discord status and response.
- **Discord responds 404 `Unknown Webhook`.** The webhook was deleted or regenerated.
  Create a new one and update the `DISCORD_WEBHOOK_URL` secret.
- **Discord responds 401 or 403.** The webhook URL is wrong or was pasted incompletely.
- **The run says `skipped`.** It was started outside a send window, for example by a
  cron-job.org test or because the two schedules do not match. Harmless.
- **Many tickers.** Discord limits a message to 2000 characters; longer messages are
  split automatically at line boundaries into several posts.

## Cost

Everything is free. cron-job.org's free plan covers a handful of daily jobs. GitHub
Actions runs the job three times a day, about one minute each; public repositories have
no minute limit and private ones get 2,000 free minutes a month. Yahoo is called once
per send time. Discord webhooks have no quota that matters here.

## Project layout

```
.github/workflows/notify.yml   dispatch-only workflow, started by cron-job.org
.github/workflows/ci.yml       tests and build on every push to main
src/config.ts       config.json + webhook URL validation
src/schedule.ts     timezone-aware send-slot decision
src/quotes.ts       Yahoo quotes with retry and chart fallback
src/format.ts       message text
src/discord.ts      webhook post with 2000-character splitting
src/app.ts          orchestration, exit codes
src/main.ts         entry: node dist/main.js [--force] [--dry-run]
test/               Vitest unit tests, all offline
docs/superpowers/   design spec and implementation plan
```
