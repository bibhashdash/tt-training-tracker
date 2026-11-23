"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveDailyLog } from "@/app/actions/logs";
import { Card, Segmented, Toggle } from "@/components/ui";
import type { IsoDate } from "@/lib/dates";
import type { DailyLog } from "@/lib/types";

type Illness = DailyLog["illness"];

interface FormState {
  sleepHours: number | null;
  dietOk: boolean;
  unplannedTreat: boolean;
  plannedIndulgence: boolean;
  illness: Illness;
  injuryNote: string;
  energy: number | null;
  bedtime: string;
}

const SLEEP_CHIPS = [
  { value: 5, label: "≤5" },
  { value: 5.5, label: "5½" },
  { value: 6, label: "6" },
  { value: 6.5, label: "6½" },
  { value: 7, label: "7" },
  { value: 7.5, label: "7½" },
  { value: 8, label: "8" },
  { value: 8.5, label: "8½" },
  { value: 9, label: "9+" },
];

const ILLNESS_OPTIONS: { value: Illness; label: string }[] = [
  { value: "none", label: "None" },
  { value: "above_neck", label: "Above neck" },
  { value: "below_neck", label: "Below neck" },
];

function fromRow(row: DailyLog | null, isFriday: boolean): FormState {
  return {
    sleepHours: row?.sleep_hours ?? null,
    dietOk: row?.diet_ok ?? true,
    unplannedTreat: row?.unplanned_drink_or_treat ?? false,
    plannedIndulgence: row?.planned_indulgence ?? isFriday,
    illness: row?.illness ?? "none",
    injuryNote: row?.injury_note ?? "",
    energy: row?.energy ?? null,
    bedtime: row?.bedtime?.slice(0, 5) ?? "",
  };
}

/** Five taps or fewer: sleep, diet, treat, indulgence, illness. Saves on every change. */
export function DailyLogForm({ date, isFriday, initial }: { date: IsoDate; isFriday: boolean; initial: DailyLog | null }) {
  const [state, setState] = useState<FormState>(() => fromRow(initial, isFriday));
  const [showInjury, setShowInjury] = useState(Boolean(initial?.injury_note));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(initial ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const dirty = useRef(false);

  const update = (patch: Partial<FormState>) => {
    dirty.current = true;
    setStatus("saving");
    setState((s) => ({ ...s, ...patch }));
  };

  // Debounced autosave of the whole row.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const r = await saveDailyLog({
          date,
          sleepHours: state.sleepHours,
          dietOk: state.dietOk,
          unplannedTreat: state.unplannedTreat,
          plannedIndulgence: state.plannedIndulgence,
          illness: state.illness,
          injuryNote: state.injuryNote,
          energy: state.energy,
          bedtime: state.bedtime || null,
        });
        if (r.ok) {
          setStatus("saved");
          setError(null);
        } else {
          setStatus("error");
          setError(r.error);
        }
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [state, date]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="mb-2 font-medium">
          Sleep <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">· last night, hours</span>
        </p>
        <Segmented
          label="Sleep hours"
          value={state.sleepHours}
          columns={5}
          options={SLEEP_CHIPS}
          onChange={(v) => update({ sleepHours: state.sleepHours === v ? null : v })}
        />
      </Card>

      <Card className="divide-y divide-zinc-200 py-1 dark:divide-zinc-800">
        <Toggle label="Diet on plan" checked={state.dietOk} onChange={(v) => update({ dietOk: v })} />
        <Toggle
          label="Unplanned drink or treat"
          checked={state.unplannedTreat}
          onChange={(v) => update({ unplannedTreat: v })}
        />
        <Toggle
          label="Planned indulgence"
          hint={isFriday ? "Friday pub. Never counted against you." : "Never counted against you."}
          checked={state.plannedIndulgence}
          onChange={(v) => update({ plannedIndulgence: v })}
        />
      </Card>

      <Card>
        <p className="mb-2 font-medium">Illness</p>
        <Segmented label="Illness" value={state.illness} options={ILLNESS_OPTIONS} onChange={(v) => update({ illness: v })} />
        {showInjury ? (
          <label className="mt-4 block">
            <span className="mb-1 block font-medium">Injury</span>
            <textarea
              rows={2}
              maxLength={500}
              placeholder="What and where? Leave empty if it's cleared."
              value={state.injuryNote}
              onChange={(e) => update({ injuryNote: e.target.value })}
              className="w-full rounded-lg border border-zinc-300 bg-transparent p-3 text-base dark:border-zinc-700"
            />
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
              Any injury note means the review suggests rest and seeing a GP.
            </span>
          </label>
        ) : (
          <button type="button" onClick={() => setShowInjury(true)} className="mt-3 h-10 text-sm text-zinc-600 dark:text-zinc-400">
            + Injury
          </button>
        )}
      </Card>

      <details className="group rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer list-none font-medium">
          Energy and bedtime <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">· optional</span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <Segmented
            label="Energy"
            value={state.energy}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))}
            onChange={(v) => update({ energy: state.energy === v ? null : v })}
          />
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm">Bedtime</span>
            <input
              type="time"
              value={state.bedtime}
              onChange={(e) => update({ bedtime: e.target.value })}
              className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
            />
          </label>
        </div>
      </details>

      <p aria-live="polite" className="h-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved"}
        {status === "idle" && "Not saved yet. Tap anything to save."}
        {status === "error" && <span className="text-red-600 dark:text-red-400">Not saved: {error}</span>}
      </p>
    </div>
  );
}
