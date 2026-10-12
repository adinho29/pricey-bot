import type { Config } from "./config.js";

/** Local wall-clock time in a given IANA timezone. weekday: 0 = Sunday ... 6 = Saturday. */
export type LocalTime = { weekday: number; hour: number; minute: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WINDOW_MINUTES = 60;

export function toLocalTime(now: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: WEEKDAYS.indexOf(get("weekday")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function shouldSend(
  now: Date,
  cfg: Pick<Config, "timezone" | "sendTimes" | "weekdaysOnly">,
): { send: boolean; reason: string } {
  const local = toLocalTime(now, cfg.timezone);
  if (cfg.weekdaysOnly && (local.weekday === 0 || local.weekday === 6)) {
    return { send: false, reason: "weekend" };
  }
  const nowMinutes = local.hour * 60 + local.minute;
  for (const slot of cfg.sendTimes) {
    const [h, m] = slot.split(":").map(Number);
    const slotMinutes = h * 60 + m;
    if (nowMinutes >= slotMinutes && nowMinutes < slotMinutes + WINDOW_MINUTES) {
      return { send: true, reason: `slot ${slot}` };
    }
  }
  return {
    send: false,
    reason: `${pad(local.hour)}:${pad(local.minute)} is not within ${WINDOW_MINUTES} min after any send time`,
  };
}
