import { describe, it, expect } from "vitest";
import { buildMessage, formatDateTime, weekdayAbbrev, cityFromTimezone } from "../src/format.js";
import type { Quote } from "../src/quotes.js";

const cfg = { timezone: "Europe/Bucharest", priceDecimals: 2, title: "ETF prices" };
const now = new Date("2026-10-12T12:07:00Z"); // Mon 15:07 Bucharest (summer time)

const quotes: Quote[] = [
  { symbol: "VWCE.DE", price: 173.24, currency: "EUR", time: new Date("2026-10-12T11:51:00Z") },
  { symbol: "AVWS.DE", price: 25.3, currency: "EUR", time: new Date("2026-10-12T11:50:00Z") },
  { symbol: "VGLA.DE", price: null, currency: null, time: null },
];

describe("buildMessage", () => {
  it("renders the exact spec format", () => {
    expect(buildMessage(quotes, now, cfg)).toBe(
      [
        "ETF prices - Mon 12.10.2026 15:07 Bucharest",
        "VWCE.DE - 173.24 EUR - 12.10.2026 14:51",
        "AVWS.DE - 25.30 EUR - 12.10.2026 14:50",
        "VGLA.DE - n/a",
      ].join("\n"),
    );
  });

  it("has no trailing newline", () => {
    expect(buildMessage(quotes, now, cfg).endsWith("\n")).toBe(false);
  });

  it("honours priceDecimals", () => {
    const msg = buildMessage([quotes[0]], now, { ...cfg, priceDecimals: 3 });
    expect(msg.split("\n")[1]).toBe("VWCE.DE - 173.240 EUR - 12.10.2026 14:51");
  });

  it("uses the configured title", () => {
    expect(buildMessage([], now, { ...cfg, title: "Portfolio" })).toBe("Portfolio - Mon 12.10.2026 15:07 Bucharest");
  });
});

describe("formatDateTime", () => {
  it("formats DD.MM.YYYY HH:mm in the target zone, crossing midnight in winter", () => {
    expect(formatDateTime(new Date("2026-01-14T23:30:00Z"), "Europe/Bucharest")).toBe("15.01.2026 01:30");
  });

  it("zero-pads hours after midnight", () => {
    expect(formatDateTime(new Date("2026-07-14T21:05:00Z"), "Europe/Bucharest")).toBe("15.07.2026 00:05");
  });
});

describe("weekdayAbbrev", () => {
  it("returns the English short weekday in the target zone", () => {
    expect(weekdayAbbrev(new Date("2026-10-18T10:00:00Z"), "Europe/Bucharest")).toBe("Sun");
    // 21:30Z on Saturday is already Sunday 00:30 in Bucharest
    expect(weekdayAbbrev(new Date("2026-10-17T21:30:00Z"), "Europe/Bucharest")).toBe("Sun");
  });
});

describe("cityFromTimezone", () => {
  it("takes the last path segment and replaces underscores", () => {
    expect(cityFromTimezone("Europe/Bucharest")).toBe("Bucharest");
    expect(cityFromTimezone("America/New_York")).toBe("New York");
    expect(cityFromTimezone("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(cityFromTimezone("UTC")).toBe("UTC");
  });
});
