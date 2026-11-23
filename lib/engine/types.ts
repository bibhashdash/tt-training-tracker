// Rules engine types. See docs/SPEC.md §4. Everything here is plain data:
// no Dates, no Supabase rows. Callers resolve ISO date strings first.
import type { IsoDate } from "../dates";

export type Illness = "none" | "above_neck" | "below_neck";
export type WeekVariant = "normal" | "minimum" | "easy_return" | "rest";

export type Suggestion =
  | "advance"
  | "repeat"
  | "minimum"
  | "repeat_after_illness"
  | "step_back"
  | "rest_injury";

export const SUGGESTIONS: Suggestion[] = [
  "advance",
  "repeat",
  "minimum",
  "repeat_after_illness",
  "step_back",
  "rest_injury",
];

export interface EngineSettings {
  sleepThresholdHours: number;
  sleepFlagNights: number;
  dietFlagDays: number;
  completionAdvancePct: number;
  completionMinimumPct: number;
}

export interface PlannedSessionIn {
  id: string;
  date: IsoDate;
  kind: "ride" | "core";
  isKey: boolean;
  /** Date is in settings.planned_off_dates. */
  plannedOff: boolean;
}

export interface SessionLogIn {
  plannedSessionId: string | null;
  date: IsoDate;
  status: "done" | "dropped" | "planned_off";
}

export interface DailyLogIn {
  date: IsoDate;
  sleepHours: number | null;
  dietOk: boolean | null;
  unplannedTreat: boolean;
  plannedIndulgence: boolean;
  illness: Illness;
  injuryNote: string | null;
}

export interface WeekInput {
  weekStart: IsoDate; // Monday
  planned: PlannedSessionIn[]; // this week's planned sessions, dates resolved
  sessionLogs: SessionLogIn[]; // this week
  dailyLogs: DailyLogIn[]; // this week plus up to 7 days before (illness streak, Sunday-night indulgence)
  settings: EngineSettings;
}

export interface Reason {
  code: string;
  text: string;
}

export interface WeekStats {
  sessionsPlanned: number; // rides counted after exclusions
  sessionsDone: number;
  completionPct: number;
  corePlanned: number; // shown, never counted
  coreDone: number;
  shortSleepNights: number;
  offPlanDays: number;
  illnessDays: number; // longest illness run touching this week
}

export interface WeekFlags {
  sessions: boolean;
  sleep: boolean;
  diet: boolean;
  count: number;
}

export interface SuggestOut {
  suggestion: Suggestion;
  reasons: Reason[];
  stats: WeekStats;
  flags: WeekFlags;
}

/** Where the plan stands for the week being reviewed. */
export interface PlanState {
  pointer: number;
  variant: WeekVariant;
  pendingAfter: number | null;
  maxPlanWeek: number; // last plan week in the block (6 for Block 1)
}

export type DecisionValue = Suggestion | { planWeek: number };

export interface NextWeekPlan {
  pointer: number;
  /** Plan week to schedule: 1..max, 0 = minimum template, null = rest (no riding). */
  planWeek: number | null;
  variant: WeekVariant;
  pendingAfter: number | null;
  /** advance was chosen at the last plan week: the block is finished. */
  blockComplete: boolean;
}
