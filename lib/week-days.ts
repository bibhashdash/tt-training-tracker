// Builds the Mon-Sun rows for the Week view from database rows. Pure and unit-tested.
import { dateOfWeekday, type IsoDate, type Weekday } from "./dates";
import type { DailyLog, PlannedSession, SessionLog, WeekPlan } from "./types";

export type SessionState = "done" | "dropped" | "planned_off" | "missed" | "pending";

export interface DaySession {
  session: PlannedSession;
  state: SessionState;
  log: SessionLog | null;
}

export interface WeekDay {
  date: IsoDate;
  weekday: Weekday;
  sessions: DaySession[];
  unplanned: SessionLog[];
  daily: DailyLog | null;
}

export interface WeekTotals {
  plannedMinutes: number; // rides, excluding planned-off days
  doneMinutes: number; // all rides done, planned or not
}

export function buildWeekDays(
  weekPlan: WeekPlan | null,
  weekStart: IsoDate,
  logs: SessionLog[],
  daily: DailyLog[],
  plannedOffDates: IsoDate[],
  today: IsoDate,
): { days: WeekDay[]; totals: WeekTotals } {
  const off = new Set(plannedOffDates);
  const sessions = weekPlan?.plan_week?.planned_sessions ?? [];
  const totals: WeekTotals = { plannedMinutes: 0, doneMinutes: 0 };

  const days = ([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((weekday): WeekDay => {
    const date = dateOfWeekday(weekStart, weekday);
    const dayLogs = logs.filter((l) => l.date === date);

    const daySessions = sessions
      .filter((s) => s.weekday === weekday)
      .map((s): DaySession => {
        const log = dayLogs.find((l) => l.planned_session_id === s.id) ?? null;
        let state: SessionState;
        if (log) state = log.status;
        else if (off.has(date)) state = "planned_off";
        else if (date < today) state = "missed";
        else state = "pending";

        if (s.kind === "ride" && state !== "planned_off") totals.plannedMinutes += s.target_minutes;
        return { session: s, state, log };
      });

    const unplanned = dayLogs.filter((l) => l.planned_session_id === null);
    for (const l of dayLogs) {
      const isCore = daySessions.some((d) => d.session.id === l.planned_session_id && d.session.kind === "core");
      if (l.status === "done" && !isCore) totals.doneMinutes += l.actual_minutes ?? 0;
    }

    return { date, weekday, sessions: daySessions, unplanned, daily: daily.find((d) => d.date === date) ?? null };
  });

  return { days, totals };
}
