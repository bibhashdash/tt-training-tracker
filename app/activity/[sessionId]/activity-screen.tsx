"use client";

import { Bluetooth, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveSessionLog } from "@/app/actions/logs";
import { btn, ErrorText, Segmented } from "@/components/ui";
import type { IsoDate, Weekday } from "@/lib/dates";
import {
  classify,
  simTargets,
  smoothed,
  stepNudge,
  summarize,
  zoneBounds,
  type NudgeState,
  type RideSummary,
} from "@/lib/hr";
import { BIKES, capFor, defaultBike, type Bike, type SlotUsed } from "@/lib/session-rules";
import type { PlannedSession } from "@/lib/types";
import { clock, LinkState, signal, SimButtons, Tiles, Tuner } from "../tuner-ui";
import { useHeartRate, useWakeLock } from "./use-heart-rate";

const RECOVERY = "Z1-2";

/** Live heart rate for one of today's planned rides; finishing prefills the Done form. */
export function ActivityScreen({
  session,
  date,
  dateLabel,
  weekday,
  cutoff,
  allowSimulator,
}: {
  session: PlannedSession;
  date: IsoDate;
  dateLabel: string;
  weekday: Weekday;
  cutoff: string;
  /** `?sim=1`: offer a simulated heart rate. */
  allowSimulator: boolean;
}) {
  const hr = useHeartRate();
  const [summary, setSummary] = useState<RideSummary | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [targetZone, setTargetZone] = useState(session.zone ?? RECOVERY);
  const [sound, setSound] = useState(false);
  const nudge = useRef<NudgeState | null>(null);

  const startedAt = hr.firstAt;
  const active = hr.status === "live" || hr.status === "reconnecting";
  useWakeLock(startedAt !== null && summary === null);

  // One-second tick for the clock and smoothing.
  useEffect(() => {
    if (startedAt === null || summary) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, summary]);

  // Warn before leaving mid-ride.
  useEffect(() => {
    if (startedAt === null || summary) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [startedAt, summary]);

  const bounds = zoneBounds(targetZone);
  const bpm = hr.latest ? smoothed(hr.samples.current, now) : null;
  const zoneStatus = bpm !== null && bounds ? classify(bpm, bounds) : null;

  // Vibrate (and optionally beep) after 10 s out of zone.
  useEffect(() => {
    if (!zoneStatus || summary) return;
    const r = stepNudge(nudge.current, zoneStatus, now);
    nudge.current = r.state;
    if (r.nudge) signal(zoneStatus, sound);
  }, [zoneStatus, now, sound, summary]);

  const finish = () => {
    const end = Date.now();
    hr.disconnect();
    setSummary(summarize(hr.samples.current, startedAt ?? end, end, zoneBounds(session.zone)));
  };

  const elapsed = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  // Key sessions (intervals) can switch between the effort zone and recovery.
  const zoneChoices = useMemo(() => {
    const zones = [session.zone ?? RECOVERY];
    if (session.is_key && session.zone !== RECOVERY) zones.push(RECOVERY);
    return zones;
  }, [session.zone, session.is_key]);

  if (summary) return <FinishForm session={session} date={date} weekday={weekday} summary={summary} />;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-500">{dateLabel}</p>
          <h1 className="text-xl font-semibold">
            Ride · {session.target_minutes} min · {session.zone ?? "easy"}
          </h1>
          {session.description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{session.description}</p>}
        </div>
        {startedAt === null && (
          <Link href="/today" aria-label="Close" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center">
            <X aria-hidden size={22} />
          </Link>
        )}
      </header>

      {startedAt === null && hr.status !== "live" ? (
        <div className="flex flex-1 flex-col justify-center gap-3">
          <p className="text-zinc-600 dark:text-zinc-400">
            Put the strap on, wet the contacts, then connect. Keep this screen open while you ride.
            {session.is_key && ` Key session: finish by ${cutoff}.`}
          </p>
          <button
            type="button"
            onClick={hr.connect}
            disabled={hr.status === "connecting"}
            className={`${btn.base} ${btn.primary} h-14 text-base`}
          >
            <Bluetooth aria-hidden size={20} className="mr-2" />
            {hr.status === "connecting" ? "Connecting…" : "Connect heart rate strap"}
          </button>
          {allowSimulator && (
            <button
              type="button"
              onClick={() => {
                hr.simulate();
                if (bounds) hr.setSimTarget(simTargets(bounds).in);
              }}
              className={`${btn.base} ${btn.secondary}`}
            >
              Use simulated heart rate
            </button>
          )}
          <ErrorText>{hr.error}</ErrorText>
        </div>
      ) : (
        <>
          <Tuner
            value={bpm}
            unit="bpm"
            bounds={bounds}
            status={zoneStatus}
            waiting="Waiting for heart rate…"
            warning={hr.latest?.contact === false ? "No skin contact" : null}
          />

          {zoneChoices.length > 1 && (
            <Segmented
              label="Target zone"
              value={targetZone}
              options={zoneChoices.map((z) => ({ value: z, label: z === RECOVERY ? `Recovery ${z}` : `Effort ${z}` }))}
              onChange={(z) => {
                setTargetZone(z);
                nudge.current = null;
              }}
            />
          )}

          <div className="flex items-baseline justify-between">
            <span className="font-mono text-4xl font-semibold tabular-nums">{clock(elapsed)}</span>
            <span className="text-sm text-zinc-500">of {session.target_minutes}:00</span>
          </div>

          <LinkState link={hr} />

          {allowSimulator && hr.deviceName === "Simulated strap" && bounds && (
            <SimButtons bounds={bounds} unit="bpm" onTarget={hr.setSimTarget} />
          )}

          <label className="flex items-center justify-between text-sm">
            <span>Beep as well as vibrate</span>
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} className="h-5 w-5" />
          </label>

          <button
            type="button"
            onClick={finish}
            disabled={!active && hr.status !== "lost"}
            className={`${btn.base} ${btn.primary} mt-auto`}
          >
            Finish ride
          </button>
        </>
      )}
    </main>
  );
}

function FinishForm({
  session,
  date,
  weekday,
  summary,
}: {
  session: PlannedSession;
  date: IsoDate;
  weekday: Weekday;
  summary: RideSummary;
}) {
  const router = useRouter();
  const [minutes, setMinutes] = useState(summary.minutes);
  const [slot, setSlot] = useState<SlotUsed>("primary");
  const [bike, setBike] = useState<Bike>(defaultBike(weekday));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cap = capFor(session, slot, bike);

  const save = () =>
    startTransition(async () => {
      const r = await saveSessionLog({
        date,
        plannedSessionId: session.id,
        status: "done",
        slotUsed: slot,
        actualMinutes: minutes,
        avgHr: summary.avgHr,
        rpe: null,
        bike,
        notes: summary.inZonePct !== null ? `${summary.inZonePct}% in zone (recorded live)` : null,
      });
      if (r.ok) router.push("/today");
      else setError(r.error ?? "Couldn't save.");
    });

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <h1 className="text-2xl font-semibold">Ride done</h1>
      <Tiles
        tiles={[
          ["Minutes", summary.minutes],
          ["Avg HR", summary.avgHr ?? "--"],
          ["In zone", `${summary.inZonePct ?? "--"}%`],
        ]}
      />

      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Minutes to log</span>
        <input
          inputMode="numeric"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value.replace(/\D/g, "")) || 0)}
          className="h-11 w-24 rounded-lg border border-zinc-300 bg-transparent px-3 text-right text-base dark:border-zinc-700"
        />
      </label>
      {cap !== null && minutes > cap && (
        <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Over the {cap} min ceiling for this slot.</p>
      )}
      <div>
        <span className="mb-1 block text-xs font-medium text-zinc-500">Slot</span>
        <Segmented
          label="Slot"
          value={slot}
          options={[
            { value: "primary", label: "Primary" },
            { value: "backup", label: "Backup" },
            { value: "other", label: "Other" },
          ]}
          onChange={setSlot}
        />
      </div>
      <div>
        <span className="mb-1 block text-xs font-medium text-zinc-500">Bike</span>
        <Segmented label="Bike" value={bike} options={BIKES} onChange={setBike} />
      </div>

      <ErrorText>{error}</ErrorText>
      <button type="button" onClick={save} disabled={pending || minutes < 1} className={`${btn.base} ${btn.primary} mt-auto`}>
        {pending ? "Saving…" : "Save as done"}
      </button>
      <Link href="/today" className="text-center text-sm text-zinc-600 underline dark:text-zinc-400">
        Discard and go back
      </Link>
    </main>
  );
}
