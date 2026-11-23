// Row types for the tables we read. Hand-written for now; once the Supabase
// project is linked these can be replaced by `supabase gen types typescript`.
import type { IsoDate, Weekday } from "./dates";

export type PlanWeekType = "habits" | "build" | "easy" | "minimum";
export type WeekVariant = "normal" | "minimum" | "easy_return" | "rest";
export type SessionKind = "ride" | "core";
export type SessionStatus = "done" | "dropped" | "planned_off";

export interface Settings {
  sleep_threshold_hours: number;
  sleep_flag_nights: number;
  diet_flag_days: number;
  completion_advance_pct: number;
  completion_minimum_pct: number;
  cutoff_time: string;
  timezone: string;
  block_start_date: IsoDate;
  review_opens_time: string;
  planned_off_dates: IsoDate[];
}

export interface PlanWeek {
  id: string;
  plan_week: number;
  block: number;
  type: PlanWeekType;
  target_minutes: number;
  notes: string | null;
}

export interface PlannedSession {
  id: string;
  weekday: Weekday;
  kind: SessionKind;
  target_minutes: number;
  max_minutes: number | null;
  backup_max_minutes: number | null;
  zone: string | null;
  is_key: boolean;
  primary_slot: string;
  backup_slot: string | null;
  description: string | null;
}

export interface WeekPlan {
  id: string;
  week_start: IsoDate;
  pointer: number;
  variant: WeekVariant;
  pending_after: number | null;
  plan_week: (PlanWeek & { planned_sessions: PlannedSession[] }) | null;
}
