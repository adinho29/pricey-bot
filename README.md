# stock-discord-bot

Posts the current price of your ETFs/stocks into a Discord channel at fixed times on
weekdays. Runs for free on GitHub Actions, reads prices from Yahoo Finance and posts
through a Discord incoming webhook. No bot account, no server, no paid service.

```
ETF prices - Mon 12.10.2026 15:07 Bucharest
VWCE.DE - 173.24 EUR - 12.10.2026 14:51
AVWS.DE - 25.34 EUR - 12.10.2026 14:50
VGLA.DE - 4.46 EUR - 12.10.2026 14:50
```

The header shows when the message was sent. Each line shows the quote's own time, so a
delayed or stale price is visible (European exchanges are ~15 minutes delayed on Yahoo).

## How it works

1. A GitHub Actions cron runs the script hourly, every day (05:00-16:00 UTC).
2. The script converts the current time to your timezone (`config.json`), skips weekends
   when `weekdaysOnly` is true, and sends only when it is within 60 minutes after one of
   your `sendTimes`. Everything else is a no-op, so daylight-saving changes need no edits.
3. It fetches all tickers in one Yahoo Finance call (three attempts, then a fallback to
   Yahoo's public chart endpoint per symbol), builds one message and posts it to the
   channel through the webhook.
4. If every price fails, or the Discord post fails, the job exits non-zero and GitHub
   emails you. If only some fail, those lines read `n/a` and the rest still go out.

## One-time setup

You need a GitHub account, a Discord server where you can manage a channel, and Node 22.9
or newer on your machine for the local steps. No credit card anywhere.

### 1. Create the webhook in Discord

1. Create a server (or use one you manage) and the channel that should receive prices.
   Invite the people who should see them.
2. Hover the channel, click the gear (*Edit Channel*) → *Integrations* → *Webhooks* →
   *New Webhook*. Give it a name such as `ETF prices`, make sure the right channel is
   selected, then *Copy Webhook URL*.

Treat that URL like a password: anyone holding it can post to the channel.

### 2. Check the message locally

```bash
git clone <this repo>
cd stock-discord-bot
npm install
cp .env.example .env        # paste the webhook URL into .env
npm run build
npm run dry-run             # prints the message, sends nothing, needs no webhook
npm run send -- --force     # posts one real message to the channel right now
```

### 3. Deploy to GitHub Actions

1. Create a **private** GitHub repository and push this code to its `main` branch.
2. In the repo: *Settings → Secrets and variables → Actions → New repository secret*.
   Name: `DISCORD_WEBHOOK_URL`. Value: the webhook URL.
3. *Actions → notify → Run workflow*, tick **force**, run. The message appears in the
   channel within a minute or two. From now on it runs on schedule.

## Changing tickers, times, weekends or timezone

Edit `config.json`, commit and push. That is the whole deployment.

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

Set `weekdaysOnly` to `false` to also post on Saturday and Sunday; nothing else needs to
change. Any `sendTimes` between 08:00 and 18:00 Bucharest time work as is. The cron fires
at 7 minutes past each hour, so `11:00` posts at about 11:07 and `11:30` posts at about
12:07; choose times on the hour for the earliest post. The hourly cron
window (05:00-16:00 UTC) is tuned for Europe/Bucharest; if you need times outside that
range, or move `timezone` far from UTC+2/+3, widen the cron hours in
`.github/workflows/notify.yml`.

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

- **A line shows `n/a`.** Yahoo had no complete quote for that symbol after the attempts
  and the fallback. Check the symbol on finance.yahoo.com. If it persists for all
  symbols, Yahoo changed something: run `npm update yahoo-finance2`, rebuild, push.
- **The job failed and GitHub emailed me.** Open the run log under *Actions*. The last
  `ERROR` line names the cause: a config field, the missing secret, all quotes failed, or
  the Discord status and response.
- **Discord responds 404 `Unknown Webhook`.** The webhook was deleted or regenerated.
  Create a new one and update the `DISCORD_WEBHOOK_URL` secret.
- **Discord responds 401 or 403.** The webhook URL is wrong or was pasted incompletely.
- **Messages stopped and the workflow says "disabled".** GitHub disables schedules in
  public repositories after 60 days without activity. The keepalive step is insurance in
  case the repo is or becomes public; if it happens anyway, open *Actions → notify* and
  click **Enable workflow**.
- **The message arrived late.** GitHub's scheduler can start cron jobs several minutes
  late. The slot window is 60 minutes, so the message still goes out with its real
  timestamp in the header.
- **Many tickers.** Discord limits a message to 2000 characters; longer messages are
  split automatically at line boundaries into several posts.

## Cost

Everything is free. The private-repo allowance for GitHub Actions is 2,000 minutes per
month; this workflow uses roughly 12 one-minute runs per day, about 360 minutes per
month. Yahoo is called twice a day. Discord webhooks have no quota that matters here.

## Project layout

```
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
