import {
  loadConfig as defaultLoadConfig,
  loadCredentials as defaultLoadCredentials,
  type Config,
  type Credentials,
} from "./config.js";
import { shouldSend } from "./schedule.js";
import { fetchQuotes as defaultFetchQuotes, type Quote } from "./quotes.js";
import { buildMessage } from "./format.js";
import { sendToChannel } from "./discord.js";

export type AppDeps = {
  now?: () => Date;
  loadConfig?: () => Config;
  loadCredentials?: () => Credentials;
  fetchQuotes?: (symbols: string[]) => Promise<Quote[]>;
  send?: (text: string, creds: Credentials) => Promise<string>;
  log?: (msg: string) => void;
  error?: (msg: string) => void;
  out?: (msg: string) => void;
};

const SUPPORTED_FLAGS = ["--force", "--dry-run"];

const stamp = () => new Date().toISOString();

/** Runs one bot cycle. Returns the process exit code. */
export async function run(argv: string[], deps: AppDeps = {}): Promise<number> {
  const log = deps.log ?? ((m: string) => console.log(`${stamp()} ${m}`));
  const error = deps.error ?? ((m: string) => console.error(`${stamp()} ERROR ${m}`));
  const out = deps.out ?? ((m: string) => console.log(m));

  const unknown = argv.filter((a) => a !== "" && !SUPPORTED_FLAGS.includes(a));
  if (unknown.length > 0) {
    error(`unknown argument(s): ${unknown.join(" ")}. Supported: ${SUPPORTED_FLAGS.join(", ")}`);
    return 1;
  }
  const dryRun = argv.includes("--dry-run");
  const force = dryRun || argv.includes("--force");
  const now = (deps.now ?? (() => new Date()))();

  let cfg: Config;
  try {
    cfg = (deps.loadConfig ?? defaultLoadConfig)();
  } catch (err) {
    error((err as Error).message);
    return 1;
  }

  const decision = force ? { send: true, reason: dryRun ? "dry run" : "forced" } : shouldSend(now, cfg);
  if (!decision.send) {
    log(`skipped: ${decision.reason}`);
    return 0;
  }
  log(`sending: ${decision.reason}`);

  let creds: Credentials | undefined;
  if (!dryRun) {
    try {
      creds = (deps.loadCredentials ?? defaultLoadCredentials)();
    } catch (err) {
      error((err as Error).message);
      return 1;
    }
  }

  let quotes: Quote[];
  try {
    const fetchQuotes = deps.fetchQuotes ?? ((symbols: string[]) => defaultFetchQuotes(symbols, { log }));
    quotes = await fetchQuotes(cfg.tickers);
  } catch (err) {
    error(`quotes: ${(err as Error).message}`);
    return 1;
  }
  const failed = quotes.filter((q) => q.price === null).map((q) => q.symbol);
  if (failed.length > 0) log(`no price for: ${failed.join(", ")}`);

  const message = buildMessage(quotes, now, cfg);
  if (dryRun) {
    out(message);
    return 0;
  }

  try {
    const id = await (deps.send ?? sendToChannel)(message, creds as Credentials);
    log(`sent (message id ${id || "n/a"})`);
    return 0;
  } catch (err) {
    error(`send: ${(err as Error).message}`);
    return 1;
  }
}
