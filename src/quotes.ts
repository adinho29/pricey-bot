import YahooFinance from "yahoo-finance2";

export type Quote = {
  symbol: string;
  price: number | null;
  currency: string | null;
  time: Date | null;
};

/** The subset of a yahoo-finance2 quote that this bot reads. */
export type RawQuote = {
  symbol: string;
  regularMarketPrice?: number;
  currency?: string;
  regularMarketTime?: Date;
};

export type QuoteClient = { quote(symbols: string[]): Promise<RawQuote[]> };

export type FetchQuotesDeps = {
  client?: QuoteClient;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 4000];

export function chartUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
}

function nullQuote(symbol: string): Quote {
  return { symbol, price: null, currency: null, time: null };
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Returns a complete Quote, or null when any of price, currency or time is missing. */
function normalise(raw: RawQuote): Quote | null {
  const { symbol, regularMarketPrice: price, currency, regularMarketTime: time } = raw;
  if (!isFiniteNumber(price)) return null;
  if (typeof currency !== "string" || currency === "") return null;
  if (!(time instanceof Date) || Number.isNaN(time.getTime())) return null;
  return { symbol, price, currency, time };
}

/** Fallback: Yahoo's public chart endpoint, which needs no cookie or crumb. */
export async function fetchChartQuote(symbol: string, fetchFn: typeof fetch = fetch): Promise<Quote> {
  try {
    const res = await fetchFn(chartUrl(symbol), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return nullQuote(symbol);
    const body = (await res.json()) as {
      chart?: { result?: Array<{ meta?: { regularMarketPrice?: unknown; currency?: unknown; regularMarketTime?: unknown } }> | null };
    };
    const meta = body.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    const currency = meta?.currency;
    const seconds = meta?.regularMarketTime;
    if (!isFiniteNumber(price) || typeof currency !== "string" || currency === "" || !isFiniteNumber(seconds)) {
      return nullQuote(symbol);
    }
    return { symbol, price, currency, time: new Date(seconds * 1000) };
  } catch {
    return nullQuote(symbol);
  }
}

export function createYahooClient(): QuoteClient {
  const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"], versionCheck: false });
  return { quote: (symbols) => yf.quote(symbols) as Promise<RawQuote[]> };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchQuotes(symbols: string[], deps: FetchQuotesDeps = {}): Promise<Quote[]> {
  const { fetchFn = fetch, sleep = defaultSleep, log = () => {} } = deps;
  const client = deps.client ?? createYahooClient();
  const found = new Map<string, Quote>();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const raws = await client.quote(symbols);
      for (const raw of raws) {
        const q = normalise(raw);
        if (q && symbols.includes(q.symbol)) found.set(q.symbol, q);
      }
      break;
    } catch (err) {
      lastError = err;
      log(`yahoo quote attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(err as Error).message}`);
      if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1]);
    }
  }

  for (const symbol of symbols.filter((s) => !found.has(s))) {
    log(`falling back to chart endpoint for ${symbol}`);
    found.set(symbol, await fetchChartQuote(symbol, fetchFn));
  }

  const quotes = symbols.map((s) => found.get(s) ?? nullQuote(s));
  if (quotes.every((q) => q.price === null)) {
    const cause = lastError ? `: ${(lastError as Error).message}` : "";
    throw new Error(`all quotes failed for ${symbols.join(", ")}${cause}`);
  }
  return quotes;
}
