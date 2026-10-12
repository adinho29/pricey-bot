import { readFileSync } from "node:fs";

export type Config = {
  timezone: string;
  sendTimes: string[];
  weekdaysOnly: boolean;
  tickers: string[];
  priceDecimals: number;
  title: string;
};

/** The Discord incoming-webhook URL. Its last path segment is a secret token. */
export type Credentials = { webhookUrl: string };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DISCORD_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);
const WEBHOOK_PATH_RE = /^\/api\/webhooks\/[^/]+\/[^/]+/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function nonEmptyStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigError(`config: "${field}" must be a non-empty array of strings`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new ConfigError(`config: "${field}" contains an empty or non-string entry`);
    }
  }
  return value as string[];
}

export function parseConfig(raw: unknown): Config {
  if (!isRecord(raw)) {
    throw new ConfigError("config: expected a JSON object at the top level");
  }
  const { timezone, sendTimes, weekdaysOnly, tickers, priceDecimals = 2, title = "ETF prices" } = raw;

  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    throw new ConfigError('config: "timezone" must be a valid IANA zone such as "Europe/Bucharest"');
  }
  const times = nonEmptyStringArray(sendTimes, "sendTimes");
  for (const t of times) {
    if (!TIME_RE.test(t)) {
      throw new ConfigError(`config: "sendTimes" entry "${t}" must be HH:mm in 24-hour format`);
    }
  }
  if (typeof weekdaysOnly !== "boolean") {
    throw new ConfigError('config: "weekdaysOnly" must be true or false');
  }
  const symbols = nonEmptyStringArray(tickers, "tickers");
  if (typeof priceDecimals !== "number" || !Number.isInteger(priceDecimals) || priceDecimals < 0 || priceDecimals > 6) {
    throw new ConfigError('config: "priceDecimals" must be an integer from 0 to 6');
  }
  if (typeof title !== "string" || title.trim() === "") {
    throw new ConfigError('config: "title" must be a non-empty string');
  }

  return { timezone, sendTimes: times, weekdaysOnly, tickers: symbols, priceDecimals, title };
}

export function loadConfig(path = "config.json"): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(`config: cannot read ${path}: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`config: ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(`missing environment variable ${name}`);
  }
  return value.trim();
}

function requireDiscordWebhookUrl(env: NodeJS.ProcessEnv, name: string): string {
  const value = requireEnv(env, name);
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  const valid =
    url !== undefined && url.protocol === "https:" && DISCORD_HOSTS.has(url.hostname) && WEBHOOK_PATH_RE.test(url.pathname);
  if (!valid) {
    throw new ConfigError(
      `${name} must be an https Discord webhook URL such as https://discord.com/api/webhooks/<id>/<token>`,
    );
  }
  return value;
}

export function loadCredentials(env: NodeJS.ProcessEnv = process.env): Credentials {
  return { webhookUrl: requireDiscordWebhookUrl(env, "DISCORD_WEBHOOK_URL") };
}
