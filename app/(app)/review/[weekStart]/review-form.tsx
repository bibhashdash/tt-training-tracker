"use client";

import { useActionState, useState } from "react";
import { submitReview, type ReviewFormState } from "@/app/actions/review";
import { btn, ErrorText } from "@/components/ui";
import { applyDecision, describeNextWeek } from "@/lib/engine/decide";
import type { DecisionValue, PlanState, Suggestion } from "@/lib/engine/types";

const OPTIONS: { value: Suggestion; label: string }[] = [
  { value: "advance", label: "Move on" },
  { value: "repeat", label: "Repeat" },
  { value: "minimum", label: "Minimum week" },
  { value: "repeat_after_illness", label: "Easy week, then repeat" },
  { value: "step_back", label: "Step back a week" },
  { value: "rest_injury", label: "Rest week" },
];

function parseChoice(choice: string): DecisionValue {
  return choice.startsWith("week:") ? { planWeek: Number(choice.slice(5)) } : (choice as Suggestion);
}

export function ReviewForm({
  weekStart,
  plan,
  suggestion,
  headline,
}: {
  weekStart: string;
  plan: PlanState;
  suggestion: Suggestion;
  headline: string;
}) {
  const [state, action, pending] = useActionState<ReviewFormState, FormData>(submitReview, {});
  const [overriding, setOverriding] = useState(false);
  const [choice, setChoice] = useState<string>(suggestion === "advance" ? "repeat" : "advance");
  const outcome = describeNextWeek(plan, applyDecision(plan, parseChoice(choice)));

  if (!overriding) {
    return (
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="weekStart" value={weekStart} />
        <input type="hidden" name="decision" value="accepted" />
        <ErrorText>{state.error}</ErrorText>
        <button type="submit" disabled={pending} className={`${btn.base} ${btn.primary}`}>
          {pending ? "Saving…" : `Accept: ${headline}`}
        </button>
        <button type="button" onClick={() => setOverriding(true)} className={`${btn.base} ${btn.secondary}`}>
          Override
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <input type="hidden" name="weekStart" value={weekStart} />
      <input type="hidden" name="decision" value="overridden" />
      <p className="font-medium">Override. You have the final say.</p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Next week</span>
        <select
          name="choice"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          className="h-12 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        >
          {OPTIONS.filter((o) => o.value !== suggestion).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <optgroup label="Jump to a plan week">
            {Array.from({ length: plan.maxPlanWeek }, (_, i) => i + 1).map((n) => (
              <option key={n} value={`week:${n}`}>
                Plan week {n}
              </option>
            ))}
          </optgroup>
        </select>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">→ {outcome}</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Why? (one line)</span>
        <input
          name="note"
          required
          maxLength={300}
          placeholder="e.g. Dropped Saturday for a family thing, legs feel fine"
          className="h-12 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
        />
      </label>

      <ErrorText>{state.error}</ErrorText>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOverriding(false)} className={`${btn.base} ${btn.secondary}`}>
          Cancel
        </button>
        <button type="submit" disabled={pending} className={`${btn.base} ${btn.primary}`}>
          {pending ? "Saving…" : "Save override"}
        </button>
      </div>
    </form>
  );
}
