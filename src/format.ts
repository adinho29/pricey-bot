import type { Config } from "./config.js";
import type { Quote } from "./quotes.js";

function parts(d: Date, options: Intl.DateTimeFormatOptions): (type: Intl.DateTimeFormatPartTypes) => string {
  const list = new Intl.DateTimeFormat("en-US", options).formatToParts(d);
  return (type) => list.find((p) => p.type === type)?.value ?? "";
}

/** "DD.MM.YYYY HH:mm" in the given zone, 24-hour clock. */
export function formatDateTime(d: Date, timeZone: string): string {
  const get = parts(d, {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
}

/** English short weekday ("Mon") in the given zone. */
export function weekdayAbbrev(d: Date, timeZone: string): string {
  return parts(d, { timeZone, weekday: "short" })("weekday");
}

/** "Europe/Bucharest" -> "Bucharest", "America/New_York" -> "New York". */
export function cityFromTimezone(timeZone: string): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

export function buildMessage(
  quotes: Quote[],
  now: Date,
  cfg: Pick<Config, "timezone" | "priceDecimals" | "title">,
): string {
  const { timezone, priceDecimals, title } = cfg;
  const header = `${title} - ${weekdayAbbrev(now, timezone)} ${formatDateTime(now, timezone)} ${cityFromTimezone(timezone)}`;
  const lines = quotes.map((q) =>
    q.price === null || q.currency === null || q.time === null
      ? `${q.symbol} - n/a`
      : `${q.symbol} - ${q.price.toFixed(priceDecimals)} ${q.currency} - ${formatDateTime(q.time, timezone)}`,
  );
  return [header, ...lines].join("\n");
}
