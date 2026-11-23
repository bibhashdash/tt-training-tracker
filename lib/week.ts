import "server-only";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { addDays, calendarWeek, hhmm, timeIn, weekStart as mondayOf, type IsoDate } from "@/lib/dates";
import { applyDecision, describeNextWeek } from "@/lib/engine/decide";
import { suggestNextWeek } from "@/lib/engine/suggest";
import type { SuggestOut } from "@/lib/engine/types";
import { loadSettings, loadWeekPlan, todayFor } from "@/lib/queries";
import { loadMaxPlanWeek, loadReview, type WeeklyReview } from "@/lib/review";
import { isReviewOpen, toPlanState, toWeekInput } from "@/lib/review-input";
import type { DailyLog, SessionLog, Settings, WeekPlan } from "@/lib/types";
import { buildWeekDays, type WeekDay, type WeekTotals } from "@/lib/week-days";

export interface WeekView {
  today: IsoDate;
  weekStart: IsoDate;
  calendarWeek: number;
  settings: Settings;
  weekPlan: WeekPlan | null;
  days: WeekDay[];
  totals: WeekTotals;
  /** Engine output; for a week in progress it covers sessions up to today only. */
  result: SuggestOut | null;
  headline: string | null;
  inProgress: boolean;
  review: WeeklyReview | null;
  reviewOpen: boolean;
  prevWeek: IsoDate | null;
  nextWeek: IsoDate | null;
}

export async function getWeekView(requested?: string): Promise<WeekView> {
  await connection();
  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);
  const today = todayFor(settings);
  const thisMonday = mondayOf(today);

  let monday = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? mondayOf(requested) : thisMonday;
  if (monday > thisMonday) monday = thisMonday;

  const [weekPlan, logs, daily, review, maxPlanWeek] = await Promise.all([
    loadWeekPlan(supabase, monday),
    supabase.from("session_logs").select("*").gte("date", monday).lte("date", addDays(monday, 6)).returns<SessionLog[]>(),
    supabase.from("daily_logs").select("*").gte("date", addDays(monday, -7)).lte("date", addDays(monday, 6)).returns<DailyLog[]>(),
    loadReview(supabase, monday),
    loadMaxPlanWeek(supabase),
  ]);
  if (logs.error) throw logs.error;
  if (daily.error) throw daily.error;

  const { days, totals } = buildWeekDays(weekPlan, monday, logs.data ?? [], daily.data ?? [], settings.planned_off_dates, today);
  const inProgress = monday === thisMonday && !review;

  let result: SuggestOut | null = null;
  let headline: string | null = null;
  if (weekPlan) {
    const input = toWeekInput(weekPlan, logs.data ?? [], daily.data ?? [], settings);
    // Mid-week, count days that are over, plus anything already logged today.
    if (inProgress) {
      const loggedIds = new Set((logs.data ?? []).map((l) => l.planned_session_id));
      input.planned = input.planned.filter((p) => p.date < today || (p.date === today && loggedIds.has(p.id)));
    }
    result = suggestNextWeek(input);
    const plan = toPlanState(weekPlan, maxPlanWeek);
    headline = describeNextWeek(plan, applyDecision(plan, review?.suggestion ?? result.suggestion));
  }

  const blockStart = settings.block_start_date;
  return {
    today,
    weekStart: monday,
    calendarWeek: calendarWeek(blockStart, monday),
    settings,
    weekPlan,
    days,
    totals,
    result,
    headline,
    inProgress,
    review,
    reviewOpen: !review && !!weekPlan && isReviewOpen(monday, today, timeIn(settings.timezone, new Date()), hhmm(settings.review_opens_time)),
    prevWeek: monday > blockStart ? addDays(monday, -7) : null,
    nextWeek: monday < thisMonday ? addDays(monday, 7) : null,
  };
}
