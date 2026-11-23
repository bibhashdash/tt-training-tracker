// Training blocks: editing drafts, "copy and progress", and validation.
// Pure and unit-tested; the editor runs the same checks in the browser.
import type { Weekday } from "./dates";
import { minutesOfDay, formatMinutesOfDay } from "./session-rules";
import type { PlannedSession, PlanWeek } from "./types";

export type BlockWeekType = "habits" | "build" | "easy";
export const BLOCK_WEEK_TYPES: BlockWeekType[] = ["habits", "build", "easy"];

export interface SessionDraft {
  weekday: Weekday;
  kind: "ride" | "core";
  target_minutes: number;
  max_minutes: number | null;
  backup_max_minutes: number | null;
  zone: string | null;
  is_key: boolean;
  primary_slot: string; // HH:MM
  backup_slot: string | null; // HH:MM
  description: string | null;
}

export interface WeekDraft {
  plan_week: number;
  type: BlockWeekType;
  notes: string | null;
  sessions: SessionDraft[];
  /** Already scheduled in some calendar week: read-only, so history stays true. */
  used: boolean;
}

export interface BlockDraft {
  block: number;
  weeks: WeekDraft[];
}

type Slot = Pick<SessionDraft, "max_minutes" | "backup_max_minutes" | "primary_slot" | "backup_slot">;

/** Block 1's weekly slots, used as defaults for new sessions. Ceilings, not targets. */
export const DEFAULT_RIDE_SLOTS: Record<Weekday, Slot> = {
  1: { max_minutes: 45, backup_max_minutes: 45, primary_slot: "07:00", backup_slot: "17:00" },
  2: { max_minutes: 45, backup_max_minutes: 45, primary_slot: "07:00", backup_slot: "18:00" },
  3: { max_minutes: 30, backup_max_minutes: 30, primary_slot: "07:00", backup_slot: "12:30" },
  4: { max_minutes: 60, backup_max_minutes: 30, primary_slot: "18:00", backup_slot: "12:30" },
  5: { max_minutes: 30, backup_max_minutes: 30, primary_slot: "07:00", backup_slot: "12:30" },
  6: { max_minutes: 90, backup_max_minutes: 90, primary_slot: "15:00", backup_slot: "19:00" },
  7: { max_minutes: null, backup_max_minutes: 120, primary_slot: "07:00", backup_slot: "15:00" },
};
const CORE_SLOT: Slot = { max_minutes: 15, backup_max_minutes: 15, primary_slot: "12:30", backup_slot: "20:00" };

export function defaultSession(weekday: Weekday, kind: "ride" | "core"): SessionDraft {
  const slot = kind === "core" ? CORE_SLOT : DEFAULT_RIDE_SLOTS[weekday];
  const cap = slot.max_minutes ?? 60;
  return {
    weekday,
    kind,
    target_minutes: kind === "core" ? 15 : Math.min(cap, 45),
    ...slot,
    zone: kind === "core" ? null : "Z1-2",
    is_key: false,
    description: kind === "core" ? "Core and mobility" : null,
  };
}

const sortSessions = (a: SessionDraft, b: SessionDraft) =>
  a.weekday - b.weekday || (a.kind === b.kind ? 0 : a.kind === "ride" ? -1 : 1);

/** DB rows -> editable blocks (template week 0 excluded). */
export function toBlockDrafts(
  weeks: (PlanWeek & { planned_sessions: PlannedSession[] })[],
  usedPlanWeekIds: Set<string>,
): BlockDraft[] {
  const byBlock = new Map<number, WeekDraft[]>();
  for (const w of [...weeks].sort((a, b) => a.plan_week - b.plan_week)) {
    if (w.block < 1 || w.type === "minimum") continue;
    const draft: WeekDraft = {
      plan_week: w.plan_week,
      type: w.type,
      notes: w.notes,
      used: usedPlanWeekIds.has(w.id),
      sessions: w.planned_sessions
        .map((s) => ({
          weekday: s.weekday,
          kind: s.kind,
          target_minutes: s.target_minutes,
          max_minutes: s.max_minutes,
          backup_max_minutes: s.backup_max_minutes,
          zone: s.zone,
          is_key: s.is_key,
          primary_slot: s.primary_slot.slice(0, 5),
          backup_slot: s.backup_slot?.slice(0, 5) ?? null,
          description: s.description,
        }))
        .sort(sortSessions),
    };
    byBlock.set(w.block, [...(byBlock.get(w.block) ?? []), draft]);
  }
  return [...byBlock.entries()].sort(([a], [b]) => a - b).map(([block, weeks]) => ({ block, weeks }));
}

export function rideMinutes(week: Pick<WeekDraft, "sessions">): number {
  return week.sessions.filter((s) => s.kind === "ride").reduce((sum, s) => sum + s.target_minutes, 0);
}

const roundTo5 = (n: number) => Math.round(n / 5) * 5;

/**
 * "Copy and progress": the next block starts from `source`. Ride targets in
 * build weeks go up by `pct`%, rounded to 5 min and never above the slot ceiling.
 * Habits and easy weeks, core and slots are copied unchanged.
 */
export function progressBlock(source: BlockDraft, firstPlanWeek: number, pct: number): BlockDraft {
  const factor = 1 + pct / 100;
  return {
    block: source.block + 1,
    weeks: source.weeks.map((w, i) => ({
      plan_week: firstPlanWeek + i,
      type: w.type,
      notes: w.notes,
      used: false,
      sessions: w.sessions.map((s) => {
        if (w.type !== "build" || s.kind !== "ride") return { ...s };
        const raised = Math.max(5, roundTo5(s.target_minutes * factor));
        return { ...s, target_minutes: s.max_minutes === null ? raised : Math.min(raised, s.max_minutes) };
      }),
    })),
  };
}

export interface Issue {
  planWeek: number;
  message: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const okInt = (n: unknown, min: number, max: number) => Number.isInteger(n) && (n as number) >= min && (n as number) <= max;

/** Hard errors block saving; warnings are shown but never block. */
export function validateBlock(
  draft: BlockDraft,
  opts: {
    cutoff: string; // HH:MM
    /** Weeks immediately before this block (oldest first), for the ramp check. */
    preceding: Pick<WeekDraft, "type" | "sessions">[];
    /** First plan week this block must start at (existing block's first week, or max + 1). */
    expectedFirstWeek: number;
    /** For blocks other than the last: the week count can't change (plan week numbers must stay contiguous). */
    fixedWeekCount: number | null;
  },
): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (planWeek: number, message: string) => errors.push({ planWeek, message });
  const warn = (planWeek: number, message: string) => warnings.push({ planWeek, message });

  if (opts.fixedWeekCount !== null && draft.weeks.length !== opts.fixedWeekCount) {
    err(0, `This block must keep ${opts.fixedWeekCount} weeks. Only the last block can grow or shrink.`);
  }
  draft.weeks.forEach((w, i) => {
    if (w.plan_week !== opts.expectedFirstWeek + i) err(w.plan_week, "Plan week numbers must run on without gaps.");
  });
  if (draft.weeks.length > 12) err(0, "A block can have at most 12 weeks.");

  const history = [...opts.preceding];
  for (const w of draft.weeks) {
    const pw = w.plan_week;
    if (!BLOCK_WEEK_TYPES.includes(w.type)) err(pw, "Pick a week type.");
    if ((w.notes ?? "").length > 300) err(pw, "Notes are limited to 300 characters.");

    const seen = new Set<string>();
    for (const s of w.sessions) {
      const label = `${DAY[s.weekday] ?? "?"} ${s.kind === "core" ? "core" : "ride"}`;
      if (!okInt(s.weekday, 1, 7)) err(pw, "Each session needs a day.");
      const key = `${s.weekday}-${s.kind}`;
      if (seen.has(key)) err(pw, `${label}: only one ${s.kind} per day.`);
      seen.add(key);
      if (!okInt(s.target_minutes, 1, 600)) err(pw, `${label}: minutes must be 1 to 600.`);
      if (s.max_minutes !== null && !okInt(s.max_minutes, 1, 600)) err(pw, `${label}: ceiling must be 1 to 600.`);
      if (s.backup_max_minutes !== null && !okInt(s.backup_max_minutes, 1, 600))
        err(pw, `${label}: backup ceiling must be 1 to 600.`);
      if (s.max_minutes !== null && s.target_minutes > s.max_minutes)
        err(pw, `${label}: ${s.target_minutes} min is over the ${s.max_minutes} min ceiling.`);
      if (!HHMM.test(s.primary_slot)) err(pw, `${label}: primary slot needs a time.`);
      if (s.backup_slot !== null && !HHMM.test(s.backup_slot)) err(pw, `${label}: backup slot isn't a valid time.`);
      if ((s.zone ?? "").length > 12) err(pw, `${label}: zone is too long.`);
      if ((s.description ?? "").length > 200) err(pw, `${label}: description is limited to 200 characters.`);

      if (s.is_key && HHMM.test(s.primary_slot) && HHMM.test(opts.cutoff)) {
        const cutoff = minutesOfDay(opts.cutoff);
        if (minutesOfDay(s.primary_slot) + s.target_minutes > cutoff) {
          warn(pw, `${label} is key but would finish after ${opts.cutoff} in its primary slot.`);
        } else if (s.backup_slot && HHMM.test(s.backup_slot)) {
          const backupMinutes = Math.min(s.target_minutes, s.backup_max_minutes ?? s.target_minutes);
          if (minutesOfDay(s.backup_slot) + backupMinutes > cutoff) {
            warn(pw, `${label} is key; its backup slot ends at ${formatMinutesOfDay(minutesOfDay(s.backup_slot) + backupMinutes)}, after ${opts.cutoff}.`);
          }
        }
      }
    }

    const minutes = rideMinutes(w);
    if (minutes === 0) warn(pw, "No rides this week.");

    // Ramp check: each build week against the previous build week. (Habits -> build is
    // a designed step up, and easy weeks are meant to dip, so neither is compared.)
    const lastBuild = w.type === "build" ? [...history].reverse().find((h) => h.type === "build") : undefined;
    if (lastBuild) {
      const before = rideMinutes(lastBuild);
      if (before > 0 && minutes > before * 1.2) {
        warn(pw, `Ride time jumps ${Math.round((minutes / before - 1) * 100)}% on the last build week (${before} → ${minutes} min). Over 20% is a big step.`);
      }
    }
    history.push(w);
  }

  return { errors, warnings };
}

/**
 * Shape-checks a block sent from the browser (server actions are public
 * endpoints). Semantic checks are validateBlock's job; this only makes sure
 * every field has the right type, and drops anything unexpected.
 */
export function parseBlockDraft(raw: unknown): { ok: true; value: BlockDraft } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const intOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isInteger(v) ? (v as number) : NaN);
  const strOrNull = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? v : undefined);

  if (!isObj(raw) || !Number.isInteger(raw.block) || !Array.isArray(raw.weeks)) return fail("Bad request.");
  if (raw.weeks.length > 12) return fail("A block can have at most 12 weeks.");

  const weeks: WeekDraft[] = [];
  for (const w of raw.weeks) {
    if (!isObj(w) || !Number.isInteger(w.plan_week) || typeof w.type !== "string" || !Array.isArray(w.sessions))
      return fail("Bad week.");
    if (w.sessions.length > 14) return fail("Too many sessions in a week.");
    const notes = strOrNull(w.notes);
    if (notes === undefined) return fail("Bad week notes.");

    const sessions: SessionDraft[] = [];
    for (const s of w.sessions) {
      if (!isObj(s)) return fail("Bad session.");
      const max = intOrNull(s.max_minutes);
      const backupMax = intOrNull(s.backup_max_minutes);
      const zone = strOrNull(s.zone);
      const backup = strOrNull(s.backup_slot);
      const description = strOrNull(s.description);
      if (
        !Number.isInteger(s.weekday) ||
        (s.kind !== "ride" && s.kind !== "core") ||
        !Number.isInteger(s.target_minutes) ||
        Number.isNaN(max) ||
        Number.isNaN(backupMax) ||
        typeof s.is_key !== "boolean" ||
        typeof s.primary_slot !== "string" ||
        zone === undefined ||
        backup === undefined ||
        description === undefined
      ) {
        return fail("Bad session.");
      }
      sessions.push({
        weekday: s.weekday as Weekday,
        kind: s.kind,
        target_minutes: s.target_minutes as number,
        max_minutes: max,
        backup_max_minutes: backupMax,
        zone: zone?.trim() || null,
        is_key: s.is_key,
        primary_slot: s.primary_slot,
        backup_slot: backup?.trim() || null,
        description: description?.trim() || null,
      });
    }
    weeks.push({
      plan_week: w.plan_week as number,
      type: w.type as BlockWeekType,
      notes: notes?.trim() || null,
      sessions: sessions.sort(sortSessions),
      used: false, // never trusted from the client
    });
  }
  return { ok: true, value: { block: raw.block as number, weeks } };
}
