"use client";

import { Segmented } from "@/components/ui";
import { BIKES, hrZone, zoneCeiling, type Bike } from "@/lib/session-rules";

export interface RideValues {
  minutes: number;
  avgHr: string;
  bike: Bike;
  rpe: number | null;
  notes: string;
}

/** Minutes stepper, avg HR, bike, and optional RPE/notes. Shared by planned and unplanned rides. */
export function RideFields({
  values,
  onChange,
  cap,
  zone,
  kind = "ride",
}: {
  values: RideValues;
  onChange: (v: RideValues) => void;
  cap: number | null;
  zone: string | null;
  /** Core sessions only need minutes (and optional notes). */
  kind?: "ride" | "core";
}) {
  const isRide = kind === "ride";
  const set = <K extends keyof RideValues>(k: K, v: RideValues[K]) => onChange({ ...values, [k]: v });
  const hr = Number(values.avgHr);
  const hrValid = values.avgHr !== "" && Number.isInteger(hr) && hr >= 40 && hr <= 230;
  const ceiling = zoneCeiling(zone);
  const overZone = hrValid && ceiling !== null && hrZone(hr) > ceiling;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Minutes</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="5 minutes less"
            onClick={() => set("minutes", Math.max(5, values.minutes - 5))}
            className="h-12 w-14 rounded-lg border border-zinc-300 text-xl dark:border-zinc-700"
          >
            −
          </button>
          <input
            aria-label="Minutes"
            inputMode="numeric"
            value={values.minutes}
            onChange={(e) => set("minutes", Number(e.target.value.replace(/\D/g, "")) || 0)}
            className="h-12 w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent text-center text-xl font-semibold dark:border-zinc-700"
          />
          <button
            type="button"
            aria-label="5 minutes more"
            onClick={() => set("minutes", values.minutes + 5)}
            className="h-12 w-14 rounded-lg border border-zinc-300 text-xl dark:border-zinc-700"
          >
            +
          </button>
        </div>
        {cap !== null && values.minutes > cap && (
          <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            Over the {cap} min ceiling for this slot. Slots are ceilings, not targets.
          </p>
        )}
      </div>

      {isRide && (<label className="block">
        <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Avg HR (optional)</span>
        <div className="flex items-center gap-2">
          <input
            inputMode="numeric"
            placeholder="bpm"
            value={values.avgHr}
            onChange={(e) => set("avgHr", e.target.value.replace(/\D/g, "").slice(0, 3))}
            className="h-12 w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700"
          />
          {hrValid && (
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                overZone
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              Z{hrZone(hr)}
              {overZone && " · above target"}
            </span>
          )}
        </div>
      </label>)}

      {isRide && (
        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Bike</span>
          <Segmented label="Bike" value={values.bike} options={BIKES} onChange={(v) => set("bike", v)} />
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer list-none text-sm text-zinc-600 dark:text-zinc-400">
          <span className="group-open:hidden">{isRide ? "+ RPE and notes" : "+ Notes"}</span>
          <span className="hidden group-open:inline">{isRide ? "RPE and notes" : "Notes"}</span>
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          {isRide && <Segmented
            label="RPE"
            value={values.rpe}
            columns={5}
            options={Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
            onChange={(v) => set("rpe", values.rpe === v ? null : v)}
          />}
          <textarea
            aria-label="Notes"
            placeholder="Notes"
            maxLength={500}
            rows={2}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-transparent p-3 text-base dark:border-zinc-700"
          />
        </div>
      </details>
    </div>
  );
}
