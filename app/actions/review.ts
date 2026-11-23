"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { applyDecision } from "@/lib/engine/decide";
import { SUGGESTIONS, type DecisionValue, type Suggestion } from "@/lib/engine/types";
import { getReviewContext } from "@/lib/review";
import { isIsoDate } from "@/lib/validation";

export type ReviewFormState = { error?: string };

/**
 * Accept the suggestion, or override it with a one-line note. The suggestion is
 * recomputed here from the database, never taken from the client.
 */
export async function submitReview(_prev: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  const weekStart = formData.get("weekStart");
  const decision = formData.get("decision");
  if (!isIsoDate(weekStart) || (decision !== "accepted" && decision !== "overridden")) {
    return { error: "Bad request." };
  }

  const ctx = await getReviewContext(weekStart);
  if (ctx.status === "decided") return { error: "This week has already been reviewed." };
  if (ctx.status !== "open") return { error: "This week can't be reviewed yet." };

  let value: DecisionValue = ctx.result.suggestion;
  let decisionValue: Suggestion = ctx.result.suggestion;
  let decisionPlanWeek: number | null = null;
  let note: string | null = null;

  if (decision === "overridden") {
    note = String(formData.get("note") ?? "").trim();
    if (!note) return { error: "Add a one-line note saying why you're overriding." };
    if (note.length > 300) return { error: "Keep the note under 300 characters." };

    const choice = String(formData.get("choice") ?? "");
    if (choice.startsWith("week:")) {
      const n = Number(choice.slice(5));
      if (!Number.isInteger(n) || n < 1 || n > ctx.plan.maxPlanWeek) return { error: "Pick a plan week." };
      value = { planWeek: n };
      decisionPlanWeek = n;
      decisionValue = n > ctx.plan.pointer ? "advance" : n < ctx.plan.pointer ? "step_back" : "repeat";
    } else if (SUGGESTIONS.includes(choice as Suggestion)) {
      value = choice as Suggestion;
      decisionValue = value;
    } else {
      return { error: "Pick what to do next week." };
    }
  }

  const next = applyDecision(ctx.plan, value);
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("record_weekly_review", {
    p_week_start: ctx.weekStart,
    p_plan_week: ctx.weekPlan.plan_week?.plan_week ?? ctx.plan.pointer,
    p_sessions_planned: ctx.result.stats.sessionsPlanned,
    p_sessions_done: ctx.result.stats.sessionsDone,
    p_completion_pct: ctx.result.stats.completionPct,
    p_flag_sessions: ctx.result.flags.sessions,
    p_flag_sleep: ctx.result.flags.sleep,
    p_flag_diet: ctx.result.flags.diet,
    p_suggestion: ctx.result.suggestion,
    p_reasons: ctx.result.reasons,
    p_decision: decision,
    p_decision_value: decisionValue,
    p_decision_plan_week: decisionPlanWeek,
    p_decision_note: note,
    p_next_week_start: ctx.nextWeekStart,
    p_next_pointer: next.pointer,
    p_next_plan_week: next.planWeek,
    p_next_variant: next.variant,
    p_next_pending_after: next.pendingAfter,
  });
  if (error) return { error: error.message };

  redirect(`/review/${ctx.weekStart}`);
}
