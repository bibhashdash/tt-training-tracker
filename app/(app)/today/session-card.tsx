"use client";

import { Activity } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteSessionLog, saveSessionLog } from "@/app/actions/logs";
import { btn, Card, ErrorText } from "@/components/ui";
import { hhmm, type IsoDate, type Weekday } from "@/lib/dates";
import { capFor, defaultBike, hrZone, latestStart, zoneCeiling, type SlotUsed } from "@/lib/session-rules";
import type { PlannedSession, SessionLog } from "@/lib/types";
import { RideFields, type RideValues } from "./ride-fields";

const BIKE_LABEL = { turbo_road: "Turbo", road_outdoor: "Road", tt_outdoor: "TT" } as const;
const SLOT_LABEL = { primary: "", backup: " · backup slot", other: " · other time" } as const;

export function SessionCard({
  session: s,
  log,
  date,
  weekday,
  plannedOff,
  tooLate,
  cutoff,
  locked,
  canStartActivity,
  threshold,
}: {
  session: PlannedSession;
  log: SessionLog | null;
  date: IsoDate;
  weekday: Weekday;
  plannedOff: boolean;
  /** Key session that can no longer finish before the cutoff (only computed for today). */
  tooLate: boolean;
  cutoff: string;
  /** The week has been reviewed: show what was logged, allow no changes. */
  locked: boolean;
  /** Today, not locked or planned off: the ride can be done live with the HR strap. */
  canStartActivity: boolean;
  /** Threshold heart rate from Settings, for zone badges. */
  threshold: number;
}) {
  const isRide = s.kind === "ride";
  const [modeState, setMode] = useState<"buttons" | SlotUsed | null>(log ? null : "buttons");
  // A summary needs a log; if there isn't one (e.g. just cleared), show the buttons.
  const mode = modeState === null && !log ? "buttons" : modeState;
  const [showLogAnyway, setShowLogAnyway] = useState(false);
  const [values, setValues] = useState<RideValues>(() => initialValues(s, log, weekday));
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

  const save = (slot: SlotUsed) =>
    run(
      () =>
        saveSessionLog({
          date,
          plannedSessionId: s.id,
          status: "done",
          slotUsed: slot,
          actualMinutes: values.minutes,
          avgHr: isRide && values.avgHr !== "" ? Number(values.avgHr) : null,
          rpe: isRide ? values.rpe : null,
          bike: isRide ? values.bike : null,
          notes: values.notes,
        }),
      () => setMode(null),
    );

  const drop = () =>
    run(
      () => saveSessionLog({ date, plannedSessionId: s.id, status: "dropped" }),
      () => setMode(null),
    );

  const clear = () =>
    run(
      () => (log ? deleteSessionLog(log.id) : Promise.resolve({ ok: true })),
      () => setMode("buttons"),
    );

  const backupCap = s.backup_max_minutes ?? s.max_minutes;
  const title = isRide ? "Ride" : "Core & mobility";

  return (
    <Card className={pending ? "opacity-70" : ""}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-lg font-semibold">
          {title} · {s.target_minutes} min
          {s.zone && <span className="font-normal text-zinc-600 dark:text-zinc-400"> · {s.zone}</span>}
        </p>
        {s.is_key && (
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
            Key
          </span>
        )}
      </div>
      {s.description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.description}</p>}
      <p className="mt-1 text-sm">
        {hhmm(s.primary_slot)}
        {s.backup_slot && (
          <span className="text-zinc-600 dark:text-zinc-400">
            {" "}
            · backup {hhmm(s.backup_slot)}
            {backupCap !== null && backupCap < s.target_minutes ? ` (${backupCap} min max)` : ""}
          </span>
        )}
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {locked ? (
          log ? (
            <LoggedSummary log={log} zone={s.zone} threshold={threshold} locked />
          ) : (
            <p className="text-sm text-zinc-500">{plannedOff ? "Planned off. Not counted." : "Not logged"}</p>
          )
        ) : plannedOff && !log ? (
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Planned off. Not counted.</p>
        ) : mode === null && log ? (
          <LoggedSummary log={log} zone={s.zone} threshold={threshold} onChange={() => setMode("buttons")} onUndo={clear} />
        ) : mode === "buttons" ? (
          tooLate && !showLogAnyway && !log ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                Too late for this one: a {s.target_minutes} min key session had to start by{" "}
                {latestStart(s.target_minutes, cutoff)} to finish before {cutoff}. Drop it, don&apos;t move it.
              </p>
              <button type="button" disabled={pending} onClick={drop} className={`${btn.base} ${btn.primary}`}>
                Dropped
              </button>
              <button type="button" onClick={() => setShowLogAnyway(true)} className={`${btn.ghost} h-10 text-sm`}>
                Already done it? Log anyway
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {isRide && canStartActivity && !log && (
                <Link href={`/activity/${s.id}`} className={`${btn.base} ${btn.primary} h-14 gap-2 text-base`}>
                  <Activity aria-hidden size={20} />
                  Start activity
                </Link>
              )}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setMode("primary")}
                  className={`${btn.base} ${isRide && canStartActivity && !log ? btn.secondary : btn.primary}`}
                >
                  Done
                </button>
                <button
                  type="button"
                  disabled={pending || !s.backup_slot}
                  onClick={() => {
                    if (backupCap !== null && values.minutes > backupCap) setValues({ ...values, minutes: backupCap });
                    setMode("backup");
                  }}
                  className={`${btn.base} ${btn.secondary}`}
                >
                  Used backup
                </button>
                <button type="button" disabled={pending} onClick={drop} className={`${btn.base} ${btn.secondary}`}>
                  Dropped
                </button>
              </div>
            </div>
          )
        ) : mode !== null ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save(mode);
            }}
            className="flex flex-col gap-3"
          >
            <p className="text-sm font-medium">{mode === "backup" ? "Done in the backup slot" : "Done"}</p>
            <RideFields
              threshold={threshold}
              values={values}
              onChange={setValues}
              cap={capFor(s, mode, values.bike)}
              zone={s.zone}
              kind={s.kind}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode(log ? null : "buttons")}
                className={`${btn.base} ${btn.secondary}`}
              >
                Cancel
              </button>
              <button type="submit" disabled={pending || values.minutes < 1} className={`${btn.base} ${btn.primary}`}>
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : null}
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}

function LoggedSummary({
  log,
  zone,
  onChange,
  onUndo,
  locked = false,
  threshold,
}: {
  log: SessionLog;
  zone: string | null;
  threshold: number;
  onChange?: () => void;
  onUndo?: () => void;
  locked?: boolean;
}) {
  const ceiling = zoneCeiling(zone);
  const z = log.avg_hr ? hrZone(log.avg_hr, threshold) : null;

  if (log.status === "dropped") {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-zinc-500">Dropped</p>
        {!locked && (
          <button type="button" onClick={onUndo} className={`${btn.ghost} h-10 px-2 text-sm`}>
            Undo
          </button>
        )}
      </div>
    );
  }
  if (log.status === "planned_off") {
    return <p className="font-medium text-zinc-500">Planned off</p>;
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="font-medium text-emerald-700 dark:text-emerald-400">
        ✓ {log.actual_minutes} min
        <span className="font-normal text-zinc-600 dark:text-zinc-400">
          {log.avg_hr && (
            <>
              {" "}
              · {log.avg_hr} bpm{" "}
              <span
                className={ceiling !== null && z !== null && z > ceiling ? "text-amber-700 dark:text-amber-300" : ""}
              >
                (Z{z})
              </span>
            </>
          )}
          {log.avg_power !== null && ` · ${log.avg_power} W`}
          {log.avg_cadence !== null && ` · ${log.avg_cadence} rpm`}
          {log.bike && ` · ${BIKE_LABEL[log.bike]}`}
          {log.slot_used && SLOT_LABEL[log.slot_used]}
        </span>
      </p>
      {!locked && (
        <button type="button" onClick={onChange} className={`${btn.ghost} h-10 px-2 text-sm`}>
          Change
        </button>
      )}
    </div>
  );
}

function initialValues(s: PlannedSession, log: SessionLog | null, weekday: Weekday): RideValues {
  if (log?.status === "done") {
    return {
      minutes: log.actual_minutes ?? s.target_minutes,
      avgHr: log.avg_hr ? String(log.avg_hr) : "",
      bike: log.bike ?? defaultBike(weekday),
      rpe: log.rpe,
      notes: log.notes ?? "",
    };
  }
  return { minutes: s.target_minutes, avgHr: "", bike: defaultBike(weekday), rpe: null, notes: "" };
}
