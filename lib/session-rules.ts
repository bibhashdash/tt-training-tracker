// Per-session rules used by the Today screen: slot caps, the key-session
// cutoff, default bike, logging window and HR zones. Pure and unit-tested.
import { addDays, weekStart, type IsoDate, type Weekday } from "./dates";
import { DEFAULT_THRESHOLD, zonesFromThreshold } from "./hr";
import type { PlannedSession } from "./types";

export type SlotUsed = "primary" | "backup" | "other";
export type Bike = "turbo_road" | "road_outdoor" | "tt_outdoor";

export const BIKES: { value: Bike; label: string }[] = [
  { value: "turbo_road", label: "Turbo" },
  { value: "road_outdoor", label: "Road" },
  { value: "tt_outdoor", label: "TT" },
];

/** Sunday has no ceiling outdoors, but the turbo is capped at 2h. */
export const TURBO_CAP_WHEN_UNLIMITED = 120;

type CapFields = Pick<PlannedSession, "max_minutes" | "backup_max_minutes">;

/** The ceiling for a session in the slot actually used, or null for no limit. */
export function capFor(s: CapFields, slot: SlotUsed, bike: Bike): number | null {
  const base = slot === "backup" ? (s.backup_max_minutes ?? s.max_minutes) : s.max_minutes;
  if (base === null && bike === "turbo_road") return TURBO_CAP_WHEN_UNLIMITED;
  return base;
}

/** Turbo on weekdays, outdoors at weekends. */
export function defaultBike(weekday: Weekday): Bike {
  return weekday <= 5 ? "turbo_road" : "road_outdoor";
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function formatMinutesOfDay(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Latest start time ("HH:MM") that still finishes a key session by the cutoff. */
export function latestStart(targetMinutes: number, cutoff: string): string {
  return formatMinutesOfDay(Math.max(0, minutesOfDay(cutoff) - targetMinutes));
}

/** A key session started now would finish after the cutoff. Non-key sessions are never too late. */
export function tooLateForKey(s: Pick<PlannedSession, "is_key" | "target_minutes">, now: string, cutoff: string): boolean {
  if (!s.is_key) return false;
  return minutesOfDay(now) + s.target_minutes > minutesOfDay(cutoff);
}

/**
 * Sessions can be logged (or corrected) for any day from the Monday of last
 * week up to today, never the future. Weekly reviews will lock past weeks (M3).
 */
export function canLogDate(date: IsoDate, today: IsoDate): boolean {
  return date <= today && date >= addDays(weekStart(today), -7);
}

/** Heart rate zone 1-5 for a threshold heart rate (172 gives the plan's original table). */
export function hrZone(hr: number, threshold: number = DEFAULT_THRESHOLD): 1 | 2 | 3 | 4 | 5 {
  const z = zonesFromThreshold(threshold);
  return ([1, 2, 3, 4] as const).find((n) => hr <= z[n][1]) ?? 5;
}

/** Highest zone allowed by a target like "Z1-2" or "Z3". Null if there isn't one. */
export function zoneCeiling(zone: string | null): number | null {
  const m = zone?.match(/Z(\d)(?:-(\d))?/i);
  if (!m) return null;
  return Number(m[2] ?? m[1]);
}
