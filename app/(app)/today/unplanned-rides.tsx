"use client";

import { useState, useTransition } from "react";
import { deleteSessionLog, saveSessionLog } from "@/app/actions/logs";
import { btn, Card, ErrorText } from "@/components/ui";
import type { IsoDate, Weekday } from "@/lib/dates";
import { defaultBike } from "@/lib/session-rules";
import type { SessionLog } from "@/lib/types";
import { RideFields, type RideValues } from "./ride-fields";

const BIKE_LABEL = { turbo_road: "Turbo", road_outdoor: "Road", tt_outdoor: "TT" } as const;

/** Unplanned rides are logged for the record only. They never count toward completion. */
export function UnplannedRides({
  rides,
  date,
  weekday,
  locked,
  threshold,
}: {
  rides: SessionLog[];
  date: IsoDate;
  weekday: Weekday;
  locked: boolean;
  threshold: number;
}) {
  const fresh = (): RideValues => ({ minutes: 30, avgHr: "", bike: defaultBike(weekday), rpe: null, notes: "" });
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<RideValues>(fresh);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else after?.();
    });
  }

  return (
    <section className="flex flex-col gap-2">
      {rides.map((r) => (
        <Card key={r.id} className="flex items-center justify-between gap-2 py-3">
          <p className="text-sm">
            <span className="font-medium">Unplanned ride</span> · {r.actual_minutes} min
            {r.avg_hr && ` · ${r.avg_hr} bpm`}
            {r.avg_power !== null && ` · ${r.avg_power} W`}
            {r.bike && ` · ${BIKE_LABEL[r.bike]}`}
          </p>
          {!locked && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => deleteSessionLog(r.id))}
              className={`${btn.ghost} h-10 px-2 text-sm`}
            >
              Remove
            </button>
          )}
        </Card>
      ))}

      {locked ? null : open ? (
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  saveSessionLog({
                    date,
                    plannedSessionId: null,
                    status: "done",
                    actualMinutes: values.minutes,
                    avgHr: values.avgHr === "" ? null : Number(values.avgHr),
                    rpe: values.rpe,
                    bike: values.bike,
                    notes: values.notes,
                  }),
                () => {
                  setOpen(false);
                  setValues(fresh());
                },
              );
            }}
            className="flex flex-col gap-3"
          >
            <div>
              <p className="font-medium">Unplanned ride</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Logged for the record. It doesn&apos;t replace a dropped session or count toward the week.
              </p>
            </div>
            <RideFields values={values} onChange={setValues} cap={null} zone={null} threshold={threshold} />
            <ErrorText>{error}</ErrorText>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOpen(false)} className={`${btn.base} ${btn.secondary}`}>
                Cancel
              </button>
              <button type="submit" disabled={pending || values.minutes < 1} className={`${btn.base} ${btn.primary}`}>
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Card>
      ) : (
        <>
          <button type="button" onClick={() => setOpen(true)} className={`${btn.ghost} h-10 self-start text-sm`}>
            + Unplanned ride
          </button>
          <ErrorText>{error}</ErrorText>
        </>
      )}
    </section>
  );
}
