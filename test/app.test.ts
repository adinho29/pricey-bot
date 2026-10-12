import { describe, it, expect } from "vitest";
import { run, type AppDeps } from "../src/app.js";
import { ConfigError, type Config, type Credentials } from "../src/config.js";
import type { Quote } from "../src/quotes.js";

const cfg: Config = {
  timezone: "Europe/Bucharest",
  sendTimes: ["11:00", "15:00"],
  weekdaysOnly: true,
  tickers: ["VWCE.DE", "AVWS.DE"],
  priceDecimals: 2,
  title: "ETF prices",
};

const creds: Credentials = { webhookUrl: "https://discord.com/api/webhooks/1/t" };

const quotes: Quote[] = [
  { symbol: "VWCE.DE", price: 173.24, currency: "EUR", time: new Date("2026-07-15T07:51:00Z") },
  { symbol: "AVWS.DE", price: 25.3, currency: "EUR", time: new Date("2026-07-15T07:50:00Z") },
];

const IN_SLOT = new Date("2026-07-15T08:07:00Z"); // Wed 11:07 Bucharest
const OUT_OF_SLOT = new Date("2026-01-14T08:07:00Z"); // Wed 10:07 Bucharest

const EXPECTED_MESSAGE = [
  "ETF prices - Wed 15.07.2026 11:07 Bucharest",
  "VWCE.DE - 173.24 EUR - 15.07.2026 10:51",
  "AVWS.DE - 25.30 EUR - 15.07.2026 10:50",
].join("\n");

function harness(overrides: Partial<AppDeps> = {}) {
  const logs: string[] = [];
  const errors: string[] = [];
  const outs: string[] = [];
  const fetchCalls: string[][] = [];
  const sendCalls: Array<{ text: string; creds: Credentials }> = [];
  let credentialLoads = 0;
  const deps: AppDeps = {
    now: () => IN_SLOT,
    loadConfig: () => cfg,
    loadCredentials: () => {
      credentialLoads++;
      return creds;
    },
    fetchQuotes: async (symbols) => {
      fetchCalls.push(symbols);
      return quotes;
    },
    send: async (text, c) => {
      sendCalls.push({ text, creds: c });
      return "ABC123";
    },
    log: (m) => logs.push(m),
    error: (m) => errors.push(m),
    out: (m) => outs.push(m),
    ...overrides,
  };
  return { deps, logs, errors, outs, fetchCalls, sendCalls, credentialLoads: () => credentialLoads };
}

describe("run", () => {
  it("skips with exit 0 outside a send slot and touches no network", async () => {
    const h = harness({ now: () => OUT_OF_SLOT });
    expect(await run([], h.deps)).toBe(0);
    expect(h.logs.some((l) => /^skipped: 10:07/.test(l))).toBe(true);
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.sendCalls).toHaveLength(0);
  });

  it("fetches the configured tickers and sends the built message inside a slot", async () => {
    const h = harness();
    expect(await run([], h.deps)).toBe(0);
    expect(h.fetchCalls).toEqual([["VWCE.DE", "AVWS.DE"]]);
    expect(h.sendCalls).toEqual([{ text: EXPECTED_MESSAGE, creds }]);
    expect(h.logs.some((l) => l.includes("sent") && l.includes("ABC123"))).toBe(true);
    expect(h.errors).toEqual([]);
  });

  it("--force sends even outside a slot", async () => {
    const h = harness({ now: () => OUT_OF_SLOT });
    expect(await run(["--force"], h.deps)).toBe(0);
    expect(h.sendCalls).toHaveLength(1);
  });

  it("--dry-run prints the message, never sends, and needs no credentials", async () => {
    const h = harness({ now: () => OUT_OF_SLOT });
    expect(await run(["--dry-run"], h.deps)).toBe(0);
    expect(h.outs).toEqual([
      ["ETF prices - Wed 14.01.2026 10:07 Bucharest", "VWCE.DE - 173.24 EUR - 15.07.2026 10:51", "AVWS.DE - 25.30 EUR - 15.07.2026 10:50"].join("\n"),
    ]);
    expect(h.sendCalls).toHaveLength(0);
    expect(h.credentialLoads()).toBe(0);
  });

  it("returns 1 with the config error message when config is invalid", async () => {
    const h = harness({
      loadConfig: () => {
        throw new ConfigError('config: "tickers" must be a non-empty array of strings');
      },
    });
    expect(await run([], h.deps)).toBe(1);
    expect(h.errors).toEqual(['config: "tickers" must be a non-empty array of strings']);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("returns 1 before fetching quotes when credentials are missing", async () => {
    const h = harness({
      loadCredentials: () => {
        throw new ConfigError("missing environment variable DISCORD_WEBHOOK_URL");
      },
    });
    expect(await run([], h.deps)).toBe(1);
    expect(h.errors[0]).toMatch(/DISCORD_WEBHOOK_URL/);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("returns 1 and does not send when every quote failed", async () => {
    const h = harness({
      fetchQuotes: async () => {
        throw new Error("all quotes failed for VWCE.DE, AVWS.DE: 429");
      },
    });
    expect(await run([], h.deps)).toBe(1);
    expect(h.errors[0]).toMatch(/all quotes failed/);
    expect(h.sendCalls).toHaveLength(0);
  });

  it("returns 1 when sending fails", async () => {
    const h = harness({
      send: async () => {
        throw new Error("Discord webhook responded 404: Unknown Webhook");
      },
    });
    expect(await run([], h.deps)).toBe(1);
    expect(h.errors[0]).toMatch(/404/);
  });

  it("still sends when only some tickers failed and logs which ones", async () => {
    const partial: Quote[] = [quotes[0], { symbol: "AVWS.DE", price: null, currency: null, time: null }];
    const h = harness({ fetchQuotes: async () => partial });
    expect(await run([], h.deps)).toBe(0);
    expect(h.sendCalls[0].text).toContain("AVWS.DE - n/a");
    expect(h.logs.some((l) => l.includes("no price for: AVWS.DE"))).toBe(true);
  });

  it("rejects unknown arguments with exit 1", async () => {
    const h = harness();
    expect(await run(["--fource"], h.deps)).toBe(1);
    expect(h.errors[0]).toMatch(/--fource/);
    expect(h.fetchCalls).toHaveLength(0);
  });
});
