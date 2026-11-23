// Turns database rows into rules-engine input, and decides when a review is open.
// Pure, so it's unit-tested without a database.
import { addDays, dateOfWeekday, isoWeekday, weekStart as mondayOf, type IsoDate } from "./dates";
import type { PlanState, WeekInput } from "./engine/types";
import { minutesOfDay } from "./session-rules";
import type { DailyLog, SessionLog, Settings, WeekPlan } from "./types";

export function toWeekInput(
  weekPlan: WeekPlan,
  sessionLogs: SessionLog[],
  dailyLogs: DailyLog[],
  settings: Settings,
): WeekInput {
  const monday = weekPlan.week_start;
  const off = new Set(settings.planned_off_dates);
  return {
    weekStart: monday,
    planned: (weekPlan.plan_week?.planned_sessions ?? []).map((s) => {
      const date = dateOfWeekday(monday, s.weekday);
      return { id: s.id, date, kind: s.kind, isKey: s.is_key, plannedOff: off.has(date) };
    }),
    sessionLogs: sessionLogs.map((l) => ({ plannedSessionId: l.planned_session_id, date: l.date, status: l.status })),
    dailyLogs: dailyLogs.map((d) => ({
      date: d.date,
      sleepHours: d.sleep_hours === null ? null : Number(d.sleep_hours),
      dietOk: d.diet_ok,
      unplannedTreat: d.unplanned_drink_or_treat,
      plannedIndulgence: d.planned_indulgence,
      illness: d.illness,
      injuryNote: d.injury_note,
    })),
    settings: {
      sleepThresholdHours: Number(settings.sleep_threshold_hours),
      sleepFlagNights: settings.sleep_flag_nights,
      dietFlagDays: settings.diet_flag_days,
      completionAdvancePct: settings.completion_advance_pct,
      completionMinimumPct: settings.completion_minimum_pct,
    },
  };
}

export function toPlanState(weekPlan: WeekPlan, maxPlanWeek: number): PlanState {
  return {
    pointer: weekPlan.pointer,
    variant: weekPlan.variant,
    pendingAfter: weekPlan.pending_after,
    maxPlanWeek,
  };
}

/**
 * A week can be reviewed once it's over, or from `opensAt` ("HH:MM") on its Sunday.
 */
export function isReviewOpen(weekStart: IsoDate, today: IsoDate, now: string, opensAt: string): boolean {
  const thisMonday = mondayOf(today);
  if (weekStart < thisMonday) return true;
  if (weekStart > thisMonday) return false;
  return isoWeekday(today) === 7 && minutesOfDay(now) >= minutesOfDay(opensAt);
}

/**
 * Next week normally follows the reviewed one. If the review happens late (the
 * rider was away), skip the missed weeks: the plan restarts this week, and the
 * gap shows on the calendar-vs-plan counter rather than as extra reviews.
 */
export function nextWeekStartAfter(weekStart: IsoDate, today: IsoDate): IsoDate {
  const following = addDays(weekStart, 7);
  const thisMonday = mondayOf(today);
  return following > thisMonday ? following : thisMonday;
}
