import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig, loadConfig, loadCredentials, ConfigError } from "../src/config.js";

const valid = {
  timezone: "Europe/Bucharest",
  sendTimes: ["11:00", "15:00"],
  weekdaysOnly: true,
  tickers: ["VWCE.DE", "AVWS.DE"],
};

describe("parseConfig", () => {
  it("accepts a valid config and applies defaults", () => {
    expect(parseConfig(valid)).toEqual({ ...valid, priceDecimals: 2, title: "ETF prices" });
  });

  it("keeps explicit priceDecimals and title", () => {
    const cfg = parseConfig({ ...valid, priceDecimals: 3, title: "Portfolio" });
    expect(cfg.priceDecimals).toBe(3);
    expect(cfg.title).toBe("Portfolio");
  });

  it("rejects a non-object document", () => {
    expect(() => parseConfig(null)).toThrow(ConfigError);
    expect(() => parseConfig([1])).toThrow(ConfigError);
  });

  it("rejects a missing timezone naming the field", () => {
    expect(() => parseConfig({ ...valid, timezone: undefined })).toThrow(ConfigError);
    expect(() => parseConfig({ ...valid, timezone: undefined })).toThrow(/timezone/);
  });

  it("rejects an unknown IANA timezone", () => {
    expect(() => parseConfig({ ...valid, timezone: "Mars/Olympus" })).toThrow(/timezone/);
  });

  it.each([["25:00"], ["9:00"], ["11:60"], ["11h00"]])("rejects sendTimes entry %s", (t) => {
    expect(() => parseConfig({ ...valid, sendTimes: [t] })).toThrow(/sendTimes/);
  });

  it("rejects empty sendTimes", () => {
    expect(() => parseConfig({ ...valid, sendTimes: [] })).toThrow(/sendTimes/);
  });

  it("rejects empty tickers", () => {
    expect(() => parseConfig({ ...valid, tickers: [] })).toThrow(/tickers/);
  });

  it("rejects a blank ticker", () => {
    expect(() => parseConfig({ ...valid, tickers: ["VWCE.DE", " "] })).toThrow(/tickers/);
  });

  it.each([[7], [2.5], [-1], ["2"]])("rejects priceDecimals %s", (d) => {
    expect(() => parseConfig({ ...valid, priceDecimals: d })).toThrow(/priceDecimals/);
  });

  it("rejects a non-boolean weekdaysOnly", () => {
    expect(() => parseConfig({ ...valid, weekdaysOnly: "yes" })).toThrow(/weekdaysOnly/);
  });
});

describe("loadConfig", () => {
  const dir = mkdtempSync(join(tmpdir(), "swb-config-"));

  it("reads and parses a JSON file", () => {
    const p = join(dir, "ok.json");
    writeFileSync(p, JSON.stringify(valid));
    expect(loadConfig(p).tickers).toEqual(["VWCE.DE", "AVWS.DE"]);
  });

  it("reports invalid JSON with the file path", () => {
    const p = join(dir, "bad.json");
    writeFileSync(p, "{ nope");
    expect(() => loadConfig(p)).toThrow(ConfigError);
    expect(() => loadConfig(p)).toThrow(p);
  });

  it("reports a missing file with the file path", () => {
    const p = join(dir, "missing.json");
    expect(() => loadConfig(p)).toThrow(p);
  });
});

describe("loadCredentials", () => {
  const url = "https://discord.com/api/webhooks/123456789/abcDEFtoken_XYZ";

  it("names the missing variable", () => {
    expect(() => loadCredentials({})).toThrow(ConfigError);
    expect(() => loadCredentials({})).toThrow(/DISCORD_WEBHOOK_URL/);
  });

  it("treats an empty value as missing", () => {
    expect(() => loadCredentials({ DISCORD_WEBHOOK_URL: "  " })).toThrow(/DISCORD_WEBHOOK_URL/);
  });

  it("rejects a value that is not an https URL", () => {
    expect(() => loadCredentials({ DISCORD_WEBHOOK_URL: "discord.com/api/webhooks/1/x" })).toThrow(/DISCORD_WEBHOOK_URL.*https/);
    expect(() => loadCredentials({ DISCORD_WEBHOOK_URL: "http://discord.com/api/webhooks/1/x" })).toThrow(/DISCORD_WEBHOOK_URL/);
  });

  it("rejects a URL that is not a Discord webhook", () => {
    expect(() => loadCredentials({ DISCORD_WEBHOOK_URL: "https://example.com/api/webhooks/1/x" })).toThrow(/DISCORD_WEBHOOK_URL/);
    expect(() => loadCredentials({ DISCORD_WEBHOOK_URL: "https://discord.com/channels/1/2" })).toThrow(/DISCORD_WEBHOOK_URL/);
  });

  it("returns the trimmed webhook URL, accepting discord.com and discordapp.com", () => {
    expect(loadCredentials({ DISCORD_WEBHOOK_URL: ` ${url} ` })).toEqual({ webhookUrl: url });
    expect(loadCredentials({ DISCORD_WEBHOOK_URL: "https://discordapp.com/api/webhooks/1/x" })).toEqual({
      webhookUrl: "https://discordapp.com/api/webhooks/1/x",
    });
  });
});

describe("loadCredentials URL normalisation", () => {
  const base = "https://discord.com/api/webhooks/123456789/abcDEFtoken_XYZ";

  it("strips a trailing slash, which Discord would otherwise reject with a 404", () => {
    expect(loadCredentials({ DISCORD_WEBHOOK_URL: `${base}/` })).toEqual({ webhookUrl: base });
  });

  it("rejects a path with a suffix after the token, such as the /slack or /github variants", () => {
    expect(() => loadCredentials({ DISCORD_WEBHOOK_URL: `${base}/slack` })).toThrow(/DISCORD_WEBHOOK_URL/);
    expect(() => loadCredentials({ DISCORD_WEBHOOK_URL: `${base}/anything/else` })).toThrow(/DISCORD_WEBHOOK_URL/);
  });

  it("keeps an existing query string such as thread_id", () => {
    expect(loadCredentials({ DISCORD_WEBHOOK_URL: `${base}?thread_id=1` })).toEqual({ webhookUrl: `${base}?thread_id=1` });
  });
});
