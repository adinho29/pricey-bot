import { describe, it, expect } from "vitest";
import { fetchQuotes, fetchChartQuote, type RawQuote, type QuoteClient } from "../src/quotes.js";

const T1 = new Date("2026-10-12T11:51:00Z");
const T2 = new Date("2026-10-12T11:50:00Z");

const rawVWCE: RawQuote = { symbol: "VWCE.DE", regularMarketPrice: 173.24, currency: "EUR", regularMarketTime: T1 };
const rawAVWS: RawQuote = { symbol: "AVWS.DE", regularMarketPrice: 25.3, currency: "EUR", regularMarketTime: T2 };
const rawVGLA: RawQuote = { symbol: "VGLA.DE", regularMarketPrice: 4.46, currency: "EUR", regularMarketTime: T2 };

function clientReturning(...responses: Array<RawQuote[] | Error>): QuoteClient & { calls: number } {
  let i = 0;
  const client = {
    calls: 0,
    async quote(_symbols: string[]) {
      client.calls++;
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return client;
}

function chartBody(price: number, currency = "EUR", unixSeconds = 1760269860) {
  return { chart: { result: [{ meta: { regularMarketPrice: price, currency, regularMarketTime: unixSeconds } }], error: null } };
}

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
    return handler(url);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const noSleep = { sleeps: [] as number[], async fn(ms: number) { noSleep.sleeps.push(ms); } };

describe("fetchQuotes", () => {
  it("maps library quotes to Quote[] in config order even when returned shuffled", async () => {
    const client = clientReturning([rawAVWS, rawVGLA, rawVWCE]);
    const { fn, calls } = fakeFetch(() => json({}, 500));
    const quotes = await fetchQuotes(["VWCE.DE", "AVWS.DE", "VGLA.DE"], { client, fetchFn: fn, sleep: noSleep.fn });
    expect(quotes).toEqual([
      { symbol: "VWCE.DE", price: 173.24, currency: "EUR", time: T1 },
      { symbol: "AVWS.DE", price: 25.3, currency: "EUR", time: T2 },
      { symbol: "VGLA.DE", price: 4.46, currency: "EUR", time: T2 },
    ]);
    expect(calls).toHaveLength(0);
  });

  it("fills symbols missing from the library response via the chart endpoint", async () => {
    const client = clientReturning([rawVWCE, rawAVWS]);
    const { fn, calls } = fakeFetch(() => json(chartBody(4.462)));
    const quotes = await fetchQuotes(["VWCE.DE", "AVWS.DE", "VGLA.DE"], { client, fetchFn: fn, sleep: noSleep.fn });
    expect(quotes[2]).toEqual({ symbol: "VGLA.DE", price: 4.462, currency: "EUR", time: new Date(1760269860 * 1000) });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://query1.finance.yahoo.com/v8/finance/chart/VGLA.DE?range=1d&interval=1d");
    expect(calls[0].headers["User-Agent"]).toMatch(/Mozilla/);
  });

  it("retries the library with 2 s then 4 s backoff before succeeding", async () => {
    const sleeps: number[] = [];
    const client = clientReturning(new Error("429 Too Many Requests"), new Error("boom"), [rawVWCE]);
    const { fn, calls } = fakeFetch(() => json({}, 500));
    const quotes = await fetchQuotes(["VWCE.DE"], { client, fetchFn: fn, sleep: async (ms) => { sleeps.push(ms); } });
    expect(quotes[0].price).toBe(173.24);
    expect(client.calls).toBe(3);
    expect(sleeps).toEqual([2000, 4000]);
    expect(calls).toHaveLength(0);
  });

  it("falls back to the chart endpoint for every symbol after three failed attempts", async () => {
    const sleeps: number[] = [];
    const client = clientReturning(new Error("down"));
    const { fn, calls } = fakeFetch((url) => json(chartBody(url.includes("VWCE") ? 173.0 : 25.0)));
    const quotes = await fetchQuotes(["VWCE.DE", "AVWS.DE"], { client, fetchFn: fn, sleep: async (ms) => { sleeps.push(ms); } });
    expect(client.calls).toBe(3);
    expect(sleeps).toEqual([2000, 4000]);
    expect(calls.map((c) => c.url)).toEqual([
      "https://query1.finance.yahoo.com/v8/finance/chart/VWCE.DE?range=1d&interval=1d",
      "https://query1.finance.yahoo.com/v8/finance/chart/AVWS.DE?range=1d&interval=1d",
    ]);
    expect(quotes.map((q) => q.price)).toEqual([173.0, 25.0]);
  });

  it("yields a null quote when the chart fallback returns a non-200 status", async () => {
    const client = clientReturning([rawVWCE]);
    const { fn } = fakeFetch(() => json({ chart: { result: null, error: { code: "Not Found" } } }, 404));
    const quotes = await fetchQuotes(["VWCE.DE", "NOPE.XX"], { client, fetchFn: fn, sleep: noSleep.fn });
    expect(quotes[1]).toEqual({ symbol: "NOPE.XX", price: null, currency: null, time: null });
  });

  it("treats a library quote missing its currency as incomplete and tries the fallback", async () => {
    const client = clientReturning([rawVWCE, { symbol: "AVWS.DE", regularMarketPrice: 25.3, regularMarketTime: T2 }]);
    const { fn, calls } = fakeFetch(() => json({}, 500));
    const quotes = await fetchQuotes(["VWCE.DE", "AVWS.DE"], { client, fetchFn: fn, sleep: noSleep.fn });
    expect(calls.map((c) => c.url)).toEqual(["https://query1.finance.yahoo.com/v8/finance/chart/AVWS.DE?range=1d&interval=1d"]);
    expect(quotes[1]).toEqual({ symbol: "AVWS.DE", price: null, currency: null, time: null });
  });

  it("treats a library quote missing its time as incomplete", async () => {
    const client = clientReturning([rawVWCE, { symbol: "AVWS.DE", regularMarketPrice: 25.3, currency: "EUR" }]);
    const { fn } = fakeFetch(() => json({}, 500));
    const quotes = await fetchQuotes(["VWCE.DE", "AVWS.DE"], { client, fetchFn: fn, sleep: noSleep.fn });
    expect(quotes[1].price).toBeNull();
  });

  it("rejects when every symbol failed", async () => {
    const client = clientReturning(new Error("down"));
    const { fn } = fakeFetch(() => json({}, 500));
    await expect(fetchQuotes(["VWCE.DE", "AVWS.DE"], { client, fetchFn: fn, sleep: noSleep.fn })).rejects.toThrow(/all quotes failed/);
  });
});

describe("fetchChartQuote", () => {
  it("parses price, currency and time from chart meta", async () => {
    const { fn } = fakeFetch(() => json(chartBody(173.34, "EUR", 1760281375)));
    expect(await fetchChartQuote("VWCE.DE", fn)).toEqual({
      symbol: "VWCE.DE",
      price: 173.34,
      currency: "EUR",
      time: new Date("2025-10-12T15:02:55.000Z"),
    });
  });

  it("returns a null quote when meta lacks a price", async () => {
    const { fn } = fakeFetch(() => json({ chart: { result: [{ meta: { currency: "EUR" } }] } }));
    expect(await fetchChartQuote("VWCE.DE", fn)).toEqual({ symbol: "VWCE.DE", price: null, currency: null, time: null });
  });

  it("returns a null quote when fetch itself throws", async () => {
    const fn = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    expect(await fetchChartQuote("VWCE.DE", fn)).toEqual({ symbol: "VWCE.DE", price: null, currency: null, time: null });
  });
});
