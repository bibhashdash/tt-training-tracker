import "server-only";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { addDays, calendarWeek, todayIn, weekStart, type IsoDate } from "@/lib/dates";
import type { DailyLog, SessionLog, Settings, WeekPlan } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

const WEEK_PLAN_SELECT = `
  id, week_start, pointer, variant, pending_after,
  plan_week:plan_weeks (
    id, plan_week, block, type, target_minutes, notes,
    planned_sessions ( id, weekday, kind, target_minutes, max_minutes, backup_max_minutes,
                       zone, is_key, primary_slot, backup_slot, description )
  )
`;

/** Loads settings, seeding Block 1 the first time a signed-in user arrives. */
export async function loadSettings(supabase: Supabase): Promise<Settings> {
  const select = () => supabase.from("settings").select("*").maybeSingle<Settings>();

  let { data, error } = await select();
  if (error) throw error;
  if (!data) {
    const seeded = await supabase.rpc("seed_block_1");
    if (seeded.error) throw seeded.error;
    ({ data, error } = await select());
    if (error) throw error;
    if (!data) throw new Error("Seeding Block 1 didn't create settings.");
  }
  return data;
}

/** Today's date in the rider's time zone. */
export function todayFor(settings: Settings): IsoDate {
  return todayIn(settings.timezone, new Date());
}

export async function loadWeekPlan(supabase: Supabase, monday: IsoDate): Promise<WeekPlan | null> {
  const { data, error } = await supabase
    .from("week_plans")
    .select(WEEK_PLAN_SELECT)
    .eq("week_start", monday)
    .maybeSingle<WeekPlan>();
  if (error) throw error;
  if (data?.plan_week) {
    const kindOrder = { ride: 0, core: 1 } as const;
    data.plan_week.planned_sessions.sort((a, b) => a.weekday - b.weekday || kindOrder[a.kind] - kindOrder[b.kind]);
  }
  return data;
}

export interface DayContext {
  today: IsoDate;
  date: IsoDate;
  weekStart: IsoDate;
  calendarWeek: number;
  settings: Settings;
  weekPlan: WeekPlan | null;
  sessionLogs: SessionLog[]; // for `date`
  weekLogs: SessionLog[]; // for the whole week of `date`
  dailyLog: DailyLog | null; // for `date`
}

/**
 * Everything the Today screen needs for one day. `requested` is an optional
 * ISO date from the URL; anything outside the loggable window falls back to today.
 */
export async function getDayContext(requested?: string): Promise<DayContext> {
  await connection(); // "today" depends on the request time
  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);
  const today = todayFor(settings);

  const earliest = addDays(weekStart(today), -7);
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today && requested >= earliest
    ? requested
    : today;
  const monday = weekStart(date);

  const [weekPlan, logs, daily] = await Promise.all([
    loadWeekPlan(supabase, monday),
    supabase
      .from("session_logs")
      .select("*")
      .gte("date", monday)
      .lte("date", addDays(monday, 6))
      .order("created_at")
      .returns<SessionLog[]>(),
    supabase.from("daily_logs").select("*").eq("date", date).maybeSingle<DailyLog>(),
  ]);
  if (logs.error) throw logs.error;
  if (daily.error) throw daily.error;

  const weekLogs = logs.data ?? [];
  return {
    today,
    date,
    weekStart: monday,
    calendarWeek: calendarWeek(settings.block_start_date, date),
    settings,
    weekPlan,
    sessionLogs: weekLogs.filter((l) => l.date === date),
    weekLogs,
    dailyLog: daily.data,
  };
}
