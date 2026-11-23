import "server-only";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { calendarWeek, todayIn, weekStart, type IsoDate } from "@/lib/dates";
import type { Settings, WeekPlan } from "@/lib/types";

const WEEK_PLAN_SELECT = `
  id, week_start, pointer, variant, pending_after,
  plan_week:plan_weeks (
    id, plan_week, block, type, target_minutes, notes,
    planned_sessions ( id, weekday, kind, target_minutes, max_minutes, backup_max_minutes,
                       zone, is_key, primary_slot, backup_slot, description )
  )
`;

/**
 * Loads settings, seeding Block 1 the first time a signed-in user arrives.
 */
async function loadSettings(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"]): Promise<Settings> {
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

export interface WeekContext {
  today: IsoDate;
  weekStart: IsoDate;
  calendarWeek: number;
  settings: Settings;
  weekPlan: WeekPlan | null;
}

/** Everything the Today screen needs: today's date in the rider's zone and this week's plan. */
export async function getWeekContext(): Promise<WeekContext> {
  await connection(); // "today" depends on the request time
  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);

  const today = todayIn(settings.timezone, new Date());
  const monday = weekStart(today);

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

  return {
    today,
    weekStart: monday,
    calendarWeek: calendarWeek(settings.block_start_date, today),
    settings,
    weekPlan: data,
  };
}
