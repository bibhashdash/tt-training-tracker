import "server-only";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { addDays, timeIn, weekStart as mondayOf, type IsoDate } from "@/lib/dates";
import { applyDecision, describeNextWeek } from "@/lib/engine/decide";
import { suggestNextWeek } from "@/lib/engine/suggest";
import type { NextWeekPlan, PlanState, Reason, Suggestion, SuggestOut } from "@/lib/engine/types";
import { loadSettings, loadWeekPlan, todayFor } from "@/lib/queries";
import { isReviewOpen, nextWeekStartAfter, toPlanState, toWeekInput } from "@/lib/review-input";
import { hhmm } from "@/lib/dates";
import type { DailyLog, SessionLog, Settings, WeekPlan } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

export interface WeeklyReview {
  id: string;
  week_start: IsoDate;
  plan_week: number;
  sessions_planned: number;
  sessions_done: number;
  completion_pct: number;
  flag_sessions: boolean;
  flag_sleep: boolean;
  flag_diet: boolean;
  suggestion: Suggestion;
  reasons: Reason[];
  decision: "accepted" | "overridden";
  decision_value: Suggestion;
  decision_plan_week: number | null;
  decision_note: string | null;
  created_at: string;
}

export type ReviewContext =
  | { status: "no_plan"; weekStart: IsoDate }
  | { status: "too_early"; weekStart: IsoDate; opensAt: string }
  | {
      status: "open" | "decided";
      weekStart: IsoDate;
      today: IsoDate;
      settings: Settings;
      weekPlan: WeekPlan;
      result: SuggestOut;
      plan: PlanState;
      /** What accepting the suggestion would schedule. */
      preview: NextWeekPlan;
      headline: string;
      nextWeekStart: IsoDate;
      review: WeeklyReview | null;
      /** What was actually scheduled, once decided. */
      scheduled: WeekPlan | null;
    };

export async function loadMaxPlanWeek(supabase: Supabase): Promise<number> {
  const { data, error } = await supabase
    .from("plan_weeks")
    .select("plan_week")
    .gt("block", 0)
    .order("plan_week", { ascending: false })
    .limit(1)
    .maybeSingle<{ plan_week: number }>();
  if (error) throw error;
  return data?.plan_week ?? 1;
}

export async function loadReview(supabase: Supabase, weekStart: IsoDate): Promise<WeeklyReview | null> {
  const { data, error } = await supabase
    .from("weekly_reviews")
    .select("*")
    .eq("week_start", weekStart)
    .maybeSingle<WeeklyReview>();
  if (error) throw error;
  return data;
}

/** True if the week containing `date` has been reviewed (its logs are locked). */
export async function isWeekLocked(supabase: Supabase, date: IsoDate): Promise<boolean> {
  const { count, error } = await supabase
    .from("weekly_reviews")
    .select("id", { count: "exact", head: true })
    .eq("week_start", mondayOf(date));
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Runs the engine for one week. Used by the review page and the submit action. */
export async function getReviewContext(weekStart: IsoDate): Promise<ReviewContext> {
  await connection();
  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);
  const today = todayFor(settings);
  const monday = mondayOf(weekStart);

  const weekPlan = await loadWeekPlan(supabase, monday);
  if (!weekPlan) return { status: "no_plan", weekStart: monday };

  const review = await loadReview(supabase, monday);
  const opensAt = hhmm(settings.review_opens_time);
  if (!review && !isReviewOpen(monday, today, timeIn(settings.timezone, new Date()), opensAt)) {
    return { status: "too_early", weekStart: monday, opensAt };
  }

  const [logs, daily, maxPlanWeek] = await Promise.all([
    supabase.from("session_logs").select("*").gte("date", monday).lte("date", addDays(monday, 6)).returns<SessionLog[]>(),
    supabase.from("daily_logs").select("*").gte("date", addDays(monday, -7)).lte("date", addDays(monday, 6)).returns<DailyLog[]>(),
    loadMaxPlanWeek(supabase),
  ]);
  if (logs.error) throw logs.error;
  if (daily.error) throw daily.error;

  const result = suggestNextWeek(toWeekInput(weekPlan, logs.data ?? [], daily.data ?? [], settings));
  const plan = toPlanState(weekPlan, maxPlanWeek);
  const preview = applyDecision(plan, result.suggestion);

  let scheduled: WeekPlan | null = null;
  if (review) {
    const { data } = await supabase.from("week_plans").select("week_start").eq("review_id", review.id).maybeSingle();
    if (data) scheduled = await loadWeekPlan(supabase, data.week_start);
  }

  return {
    status: review ? "decided" : "open",
    weekStart: monday,
    today,
    settings,
    weekPlan,
    result,
    plan,
    preview,
    headline: describeNextWeek(plan, preview),
    nextWeekStart: nextWeekStartAfter(monday, today),
    review,
    scheduled,
  };
}

export interface PendingReview {
  weekStart: IsoDate;
  /** Last week is over and unreviewed: this week has no plan until it's done. */
  blocking: boolean;
}

/** The week waiting for review, if any, for the Today banner. */
export async function getPendingReview(supabase: Supabase, settings: Settings, today: IsoDate): Promise<PendingReview | null> {
  const { data: latest, error } = await supabase
    .from("week_plans")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle<{ week_start: IsoDate }>();
  if (error) throw error;
  if (!latest) return null;
  if (await loadReview(supabase, latest.week_start)) return null;

  const thisMonday = mondayOf(today);
  if (latest.week_start < thisMonday) return { weekStart: latest.week_start, blocking: true };
  const now = timeIn(settings.timezone, new Date());
  if (isReviewOpen(latest.week_start, today, now, hhmm(settings.review_opens_time))) {
    return { weekStart: latest.week_start, blocking: false };
  }
  return null;
}
