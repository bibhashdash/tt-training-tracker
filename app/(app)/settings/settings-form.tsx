"use client";

import { useActionState } from "react";
import { saveSettings, type SettingsState } from "@/app/actions/settings";
import { btn, Card, ErrorText } from "@/components/ui";
import type { Settings } from "@/lib/types";

const input =
  "h-11 w-24 rounded-lg border border-zinc-300 bg-transparent px-3 text-right text-base dark:border-zinc-700";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function SettingsForm({ settings: s }: { settings: Settings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveSettings, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4">
      <Card className="divide-y divide-zinc-200 py-1 dark:divide-zinc-800">
        <p className="py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Weekly flags</p>
        <Field label="Short night" hint="Sleep below this many hours">
          <input name="sleep_threshold_hours" type="number" step="0.5" min="0" max="16" defaultValue={s.sleep_threshold_hours} className={input} />
        </Field>
        <Field label="Sleep flag" hint="Short nights in a week to raise it">
          <input name="sleep_flag_nights" type="number" min="1" max="7" defaultValue={s.sleep_flag_nights} className={input} />
        </Field>
        <Field label="Diet flag" hint="Unplanned off-plan days in a week">
          <input name="diet_flag_days" type="number" min="1" max="7" defaultValue={s.diet_flag_days} className={input} />
        </Field>
      </Card>

      <Card className="divide-y divide-zinc-200 py-1 dark:divide-zinc-800">
        <p className="py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Completion</p>
        <Field label="Advance at" hint="% of rides done to move on">
          <input name="completion_advance_pct" type="number" min="0" max="100" defaultValue={s.completion_advance_pct} className={input} />
        </Field>
        <Field label="Minimum below" hint="% that triggers a minimum week">
          <input name="completion_minimum_pct" type="number" min="0" max="100" defaultValue={s.completion_minimum_pct} className={input} />
        </Field>
      </Card>

      <Card className="divide-y divide-zinc-200 py-1 dark:divide-zinc-800">
        <p className="py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Sessions</p>
        <Field label="Key session cutoff" hint="Hard sessions must finish by">
          <input name="cutoff_time" type="time" defaultValue={s.cutoff_time.slice(0, 5)} className={`${input} w-32`} />
        </Field>
        <label className="block py-2">
          <span className="block text-sm font-medium">Planned-off dates</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">
            One per line, YYYY-MM-DD. Sessions on these days are never counted.
          </span>
          <textarea
            name="planned_off_dates"
            rows={3}
            defaultValue={s.planned_off_dates.join("\n")}
            className="mt-2 w-full rounded-lg border border-zinc-300 bg-transparent p-3 font-mono text-sm dark:border-zinc-700"
          />
        </label>
      </Card>

      <ErrorText>{state.status === "error" ? state.error : null}</ErrorText>
      <button type="submit" disabled={pending} className={`${btn.base} ${btn.primary}`}>
        {pending ? "Saving…" : state.status === "saved" ? "Saved ✓" : "Save settings"}
      </button>
    </form>
  );
}
