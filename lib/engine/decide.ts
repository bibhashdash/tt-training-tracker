// applyDecision: the accepted or overridden decision -> next week's plan. Pure; see docs/SPEC.md §4.3.
import type { DecisionValue, NextWeekPlan, PlanState } from "./types";

export function applyDecision(state: PlanState, value: DecisionValue): NextWeekPlan {
  const { pointer, variant, pendingAfter, maxPlanWeek } = state;
  const normal = (week: number, blockComplete = false): NextWeekPlan => ({
    pointer: week,
    planWeek: week,
    variant: "normal",
    pendingAfter: null,
    blockComplete,
  });

  if (typeof value === "object") {
    return normal(Math.min(Math.max(Math.round(value.planWeek), 1), maxPlanWeek));
  }

  // After a minimum, easy-return or rest week the pointer hasn't moved, so a
  // good week returns to the plan week that was on hold rather than skipping it.
  const onHold = variant !== "normal";
  const resumeAt = pendingAfter ?? pointer;

  switch (value) {
    case "advance":
      if (onHold) return normal(resumeAt);
      if (pointer >= maxPlanWeek) return normal(maxPlanWeek, true);
      return normal(pointer + 1);
    case "repeat":
      return normal(onHold ? resumeAt : pointer);
    case "minimum":
      return { pointer, planWeek: 0, variant: "minimum", pendingAfter: null, blockComplete: false };
    case "repeat_after_illness":
      return { pointer, planWeek: 0, variant: "easy_return", pendingAfter: pointer, blockComplete: false };
    case "step_back":
      return normal(Math.max(pointer - 1, 1));
    case "rest_injury":
      return { pointer, planWeek: null, variant: "rest", pendingAfter: null, blockComplete: false };
  }
}

/** Plain-English headline for a next-week plan, e.g. "Move on to plan week 3". */
export function describeNextWeek(current: PlanState, next: NextWeekPlan): string {
  if (next.variant === "rest") return "Rest week. See a GP before riding again.";
  if (next.variant === "easy_return") return `Easy week, then plan week ${next.pendingAfter}`;
  if (next.variant === "minimum") return `Minimum week (plan week ${next.pointer} on hold)`;
  if (next.blockComplete) return `Block complete. Repeat plan week ${next.planWeek} until Block 2 is added`;
  if (current.variant !== "normal" && next.planWeek === current.pointer) return `Back to plan week ${next.planWeek}`;
  if (next.planWeek! > current.pointer) return `Move on to plan week ${next.planWeek}`;
  if (next.planWeek! < current.pointer) return `Step back to plan week ${next.planWeek}`;
  return `Repeat plan week ${next.planWeek}`;
}
