import { describe, it, expect } from "vitest";
import { shouldSend, toLocalTime } from "../src/schedule.js";

const cfg = { timezone: "Europe/Bucharest", sendTimes: ["11:00", "15:00"], weekdaysOnly: true };

describe("toLocalTime", () => {
  it("converts a UTC instant to local wall-clock in summer time", () => {
    expect(toLocalTime(new Date("2026-07-15T08:07:00Z"), "Europe/Bucharest")).toEqual({
      weekday: 3,
      hour: 11,
      minute: 7,
    });
  });

  it("converts a UTC instant to local wall-clock in winter time", () => {
    expect(toLocalTime(new Date("2026-01-14T08:07:00Z"), "Europe/Bucharest")).toEqual({
      weekday: 3,
      hour: 10,
      minute: 7,
    });
  });

  it("reports midnight as hour 0 and Sunday as weekday 0", () => {
    expect(toLocalTime(new Date("2026-10-17T21:30:00Z"), "Europe/Bucharest")).toEqual({
      weekday: 0,
      hour: 0,
      minute: 30,
    });
  });
});

describe("shouldSend", () => {
  it("sends during the 11:00 slot in summer (08:07Z = 11:07 local)", () => {
    expect(shouldSend(new Date("2026-07-15T08:07:00Z"), cfg)).toEqual({ send: true, reason: "slot 11:00" });
  });

  it("skips at 08:07Z in winter because that is 10:07 local", () => {
    const result = shouldSend(new Date("2026-01-14T08:07:00Z"), cfg);
    expect(result.send).toBe(false);
    expect(result.reason).toMatch(/10:07/);
  });

  it("sends at 09:07Z in winter because that is 11:07 local", () => {
    expect(shouldSend(new Date("2026-01-14T09:07:00Z"), cfg)).toEqual({ send: true, reason: "slot 11:00" });
  });

  it("sends at exactly the slot minute", () => {
    expect(shouldSend(new Date("2026-07-15T08:00:00Z"), cfg).send).toBe(true);
  });

  it("sends at the last minute of the window", () => {
    expect(shouldSend(new Date("2026-07-15T08:59:00Z"), cfg).send).toBe(true);
  });

  it("does not send once the window has closed (12:00 local)", () => {
    expect(shouldSend(new Date("2026-07-15T09:00:00Z"), cfg).send).toBe(false);
  });

  it("sends during the 15:00 slot", () => {
    expect(shouldSend(new Date("2026-07-15T12:07:00Z"), cfg)).toEqual({ send: true, reason: "slot 15:00" });
  });

  it("skips weekends when weekdaysOnly is true", () => {
    expect(shouldSend(new Date("2026-10-17T08:07:00Z"), cfg)).toEqual({ send: false, reason: "weekend" });
  });

  it("sends on a Saturday when weekdaysOnly is false", () => {
    expect(shouldSend(new Date("2026-10-17T08:07:00Z"), { ...cfg, weekdaysOnly: false }).send).toBe(true);
  });

  it("handles a half-hour slot: 12:07 local is inside [11:30, 12:30)", () => {
    expect(shouldSend(new Date("2026-07-15T09:07:00Z"), { ...cfg, sendTimes: ["11:30"] })).toEqual({
      send: true,
      reason: "slot 11:30",
    });
  });

  it("does not wrap a late slot window past midnight", () => {
    // 23:30 slot; 00:10 local next day must not count
    expect(shouldSend(new Date("2026-07-15T21:10:00Z"), { ...cfg, sendTimes: ["23:30"] }).send).toBe(false);
  });
});
