// Input validation for server actions. Server actions are public endpoints,
// so everything coming from the client is checked here before it reaches the DB.
import type { Bike, SlotUsed } from "./session-rules";
import type { SessionStatus } from "./types";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: SessionStatus[] = ["done", "dropped", "planned_off"];
const SLOTS: SlotUsed[] = ["primary", "backup", "other"];
const BIKE_VALUES: Bike[] = ["turbo_road", "road_outdoor", "tt_outdoor"];
const ILLNESS = ["none", "above_neck", "below_neck"] as const;
export type Illness = (typeof ILLNESS)[number];

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** null/undefined/"" -> null; otherwise an integer within [min, max] or an error. */
function optionalInt(v: unknown, min: number, max: number): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) return "invalid";
  return n;
}

function optionalText(v: unknown, maxLength: number): string | null | "invalid" {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return "invalid";
  const t = v.trim();
  if (t.length > maxLength) return "invalid";
  return t === "" ? null : t;
}

// --- session logs -----------------------------------------------------------

export interface SessionLogValues {
  date: string;
  planned_session_id: string | null;
  status: SessionStatus;
  slot_used: SlotUsed | null;
  actual_minutes: number | null;
  avg_hr: number | null;
  rpe: number | null;
  bike: Bike | null;
  notes: string | null;
}

export function parseSessionLog(raw: unknown): Result<SessionLogValues> {
  if (!isObject(raw)) return fail("Bad request.");
  const { date, plannedSessionId, status } = raw;

  if (!isIsoDate(date)) return fail("Bad date.");
  if (plannedSessionId !== null && (typeof plannedSessionId !== "string" || !UUID.test(plannedSessionId)))
    return fail("Bad session.");
  if (!STATUSES.includes(status as SessionStatus)) return fail("Bad status.");
  const s = status as SessionStatus;
  const planned = plannedSessionId as string | null;

  if (planned === null && s !== "done") return fail("Unplanned rides can only be logged as done.");

  if (s !== "done") {
    return ok({
      date, planned_session_id: planned, status: s,
      slot_used: null, actual_minutes: null, avg_hr: null, rpe: null, bike: null, notes: null,
    });
  }

  const slot = planned === null ? "other" : raw.slotUsed;
  if (!SLOTS.includes(slot as SlotUsed)) return fail("Pick which slot you used.");
  const minutes = optionalInt(raw.actualMinutes, 1, 600);
  if (minutes === null || minutes === "invalid") return fail("Minutes must be between 1 and 600.");
  const hr = optionalInt(raw.avgHr, 40, 230);
  if (hr === "invalid") return fail("Average HR must be between 40 and 230.");
  const rpe = optionalInt(raw.rpe, 1, 10);
  if (rpe === "invalid") return fail("RPE must be 1 to 10.");
  const bike = raw.bike ?? null; // core sessions have no bike
  if (bike !== null && !BIKE_VALUES.includes(bike as Bike)) return fail("Pick a bike.");
  const notes = optionalText(raw.notes, 500);
  if (notes === "invalid") return fail("Notes are limited to 500 characters.");

  return ok({
    date, planned_session_id: planned, status: s, slot_used: slot as SlotUsed,
    actual_minutes: minutes, avg_hr: hr, rpe, bike: bike as Bike | null, notes,
  });
}

// --- daily logs -------------------------------------------------------------

export interface DailyLogValues {
  date: string;
  sleep_hours: number | null;
  bedtime: string | null;
  diet_ok: boolean | null;
  unplanned_drink_or_treat: boolean;
  planned_indulgence: boolean;
  illness: Illness;
  injury_note: string | null;
  energy: number | null;
}

export function parseDailyLog(raw: unknown): Result<DailyLogValues> {
  if (!isObject(raw)) return fail("Bad request.");
  if (!isIsoDate(raw.date)) return fail("Bad date.");

  let sleep: number | null = null;
  if (raw.sleepHours !== null && raw.sleepHours !== undefined) {
    const n = Number(raw.sleepHours);
    if (!Number.isFinite(n) || n < 0 || n > 16) return fail("Sleep must be between 0 and 16 hours.");
    sleep = Math.round(n * 10) / 10;
  }

  const bedtime = raw.bedtime ?? null;
  if (bedtime !== null && (typeof bedtime !== "string" || !HHMM.test(bedtime))) return fail("Bad bedtime.");

  if (raw.dietOk !== null && raw.dietOk !== undefined && typeof raw.dietOk !== "boolean") return fail("Bad diet value.");
  if (typeof raw.unplannedTreat !== "boolean" || typeof raw.plannedIndulgence !== "boolean")
    return fail("Bad toggle value.");
  if (!ILLNESS.includes(raw.illness as Illness)) return fail("Bad illness value.");

  const injury = optionalText(raw.injuryNote, 500);
  if (injury === "invalid") return fail("Injury note is limited to 500 characters.");
  const energy = optionalInt(raw.energy, 1, 5);
  if (energy === "invalid") return fail("Energy must be 1 to 5.");

  return ok({
    date: raw.date,
    sleep_hours: sleep,
    bedtime,
    diet_ok: (raw.dietOk as boolean | null | undefined) ?? null,
    unplanned_drink_or_treat: raw.unplannedTreat,
    planned_indulgence: raw.plannedIndulgence,
    illness: raw.illness as Illness,
    injury_note: injury,
    energy,
  });
}

// --- settings ---------------------------------------------------------------

export interface SettingsValues {
  sleep_threshold_hours: number;
  sleep_flag_nights: number;
  diet_flag_days: number;
  completion_advance_pct: number;
  completion_minimum_pct: number;
  cutoff_time: string;
  planned_off_dates: string[];
}

export function parseSettings(form: Record<string, unknown>): Result<SettingsValues> {
  const sleep = Number(form.sleep_threshold_hours);
  if (!Number.isFinite(sleep) || sleep < 0 || sleep > 16) return fail("Sleep threshold must be 0 to 16 hours.");

  const ints: [keyof SettingsValues, string, number, number][] = [
    ["sleep_flag_nights", "Short-sleep nights", 1, 7],
    ["diet_flag_days", "Off-plan days", 1, 7],
    ["completion_advance_pct", "Advance %", 0, 100],
    ["completion_minimum_pct", "Minimum %", 0, 100],
  ];
  const nums: Record<string, number> = {};
  for (const [key, label, min, max] of ints) {
    const n = optionalInt(form[key], min, max);
    if (n === null || n === "invalid") return fail(`${label} must be a whole number from ${min} to ${max}.`);
    nums[key] = n;
  }
  if (nums.completion_minimum_pct > nums.completion_advance_pct)
    return fail("Minimum % can't be higher than advance %.");

  const cutoff = String(form.cutoff_time ?? "").slice(0, 5);
  if (!HHMM.test(cutoff)) return fail("Cutoff must be a time like 19:00.");

  const dates = String(form.planned_off_dates ?? "")
    .split(/[\s,]+/)
    .filter(Boolean);
  const badDate = dates.find((d) => !isIsoDate(d));
  if (badDate) return fail(`"${badDate}" isn't a date. Use YYYY-MM-DD.`);

  return ok({
    sleep_threshold_hours: Math.round(sleep * 10) / 10,
    sleep_flag_nights: nums.sleep_flag_nights,
    diet_flag_days: nums.diet_flag_days,
    completion_advance_pct: nums.completion_advance_pct,
    completion_minimum_pct: nums.completion_minimum_pct,
    cutoff_time: cutoff,
    planned_off_dates: [...new Set(dates)].sort(),
  });
}
