"use client";

import { ArrowDown, ArrowUp, Bluetooth, Check, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveSessionLog } from "@/app/actions/logs";
import { btn, ErrorText, Segmented } from "@/components/ui";
import type { IsoDate, Weekday } from "@/lib/dates";
import {
  classify,
  gaugePosition,
  gaugeRange,
  smoothed,
  stepNudge,
  summarize,
  zoneBounds,
  type Bounds,
  type NudgeState,
  type RideSummary,
  type ZoneStatus,
} from "@/lib/hr";
import { BIKES, capFor, defaultBike, type Bike, type SlotUsed } from "@/lib/session-rules";
import type { PlannedSession } from "@/lib/types";
import { useHeartRate, useWakeLock } from "./use-heart-rate";

const STATUS_UI: Record<ZoneStatus, { text: string; panel: string; Icon: typeof Check }> = {
  under: { text: "Push on", panel: "bg-sky-600 text-white", Icon: ArrowUp },
  in: { text: "In zone", panel: "bg-emerald-600 text-white", Icon: Check },
  over: { text: "Ease off", panel: "bg-red-600 text-white", Icon: ArrowDown },
};

const RECOVERY = "Z1-2";
const DEMO_ZONES = ["Z1-2", "Z2", "Z3", "Z4"];

export function ActivityScreen({
  session,
  date,
  dateLabel,
  weekday,
  cutoff,
  allowSimulator,
  demo = false,
}: {
  session: PlannedSession;
  date: IsoDate;
  dateLabel: string;
  weekday: Weekday;
  cutoff: string;
  allowSimulator: boolean;
  /** Practice mode: any zone, simulator available, nothing is saved. */
  demo?: boolean;
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
    setSummary(summarize(hr.samples.current, startedAt ?? end, end, zoneBounds(demo ? targetZone : session.zone)));
  };

  const elapsed = startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
  const zoneChoices = useMemo(() => {
    if (demo) return DEMO_ZONES;
    const zones = [session.zone ?? RECOVERY];
    if (session.is_key && session.zone !== RECOVERY) zones.push(RECOVERY);
    return zones;
  }, [session.zone, session.is_key, demo]);

  const zonePicker = (
    <Segmented
      label="Target zone"
      value={targetZone}
      options={zoneChoices.map((z) => ({
        value: z,
        label: demo ? z : z === RECOVERY ? `Recovery ${z}` : `Effort ${z}`,
      }))}
      onChange={(z) => {
        setTargetZone(z);
        nudge.current = null;
      }}
    />
  );

  if (summary) {
    return demo ? (
      <DemoSummary summary={summary} zone={targetZone} />
    ) : (
      <FinishForm session={session} date={date} weekday={weekday} summary={summary} />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <header className="flex items-start justify-between gap-3">
        {demo ? (
          <div>
            <h1 className="text-xl font-semibold">Heart rate demo</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Practice with the strap or the simulator. Nothing is saved.</p>
          </div>
        ) : (
          <div>
            <p className="text-sm text-zinc-500">{dateLabel}</p>
            <h1 className="text-xl font-semibold">
              Ride · {session.target_minutes} min · {session.zone ?? "easy"}
            </h1>
            {session.description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{session.description}</p>}
          </div>
        )}
        {startedAt === null && (
          <Link href={demo ? "/settings" : "/today"} aria-label="Close" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center">
            <X aria-hidden size={22} />
          </Link>
        )}
      </header>

      {demo && zonePicker}

      {startedAt === null && hr.status !== "live" ? (
        <ConnectPanel hr={hr} allowSimulator={allowSimulator} cutoff={cutoff} isKey={session.is_key} />
      ) : (
        <>
          <Tuner bpm={bpm} bounds={bounds} status={zoneStatus} contact={hr.latest?.contact ?? null} />

          {!demo && zoneChoices.length > 1 && zonePicker}

          <div className="flex items-baseline justify-between">
            <span className="font-mono text-4xl font-semibold tabular-nums">{clock(elapsed)}</span>
            {!demo && <span className="text-sm text-zinc-500">of {session.target_minutes}:00</span>}
          </div>

          <LinkState hr={hr} />

          {allowSimulator && hr.deviceName === "Simulated strap" && (
            <div className="grid grid-cols-3 gap-2">
              {[110, 145, 165].map((t) => (
                <button key={t} type="button" onClick={() => hr.setSimTarget(t)} className={`${btn.base} ${btn.secondary}`}>
                  Sim {t}
                </button>
              ))}
            </div>
          )}

          <label className="flex items-center justify-between text-sm">
            <span>Beep as well as vibrate</span>
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} className="h-5 w-5" />
          </label>

          <button type="button" onClick={finish} disabled={!active && hr.status !== "lost"} className={`${btn.base} ${btn.primary} mt-auto`}>
            {demo ? "Stop" : "Finish ride"}
          </button>
        </>
      )}
    </main>
  );
}

function ConnectPanel({
  hr,
  allowSimulator,
  cutoff,
  isKey,
}: {
  hr: ReturnType<typeof useHeartRate>;
  allowSimulator: boolean;
  cutoff: string;
  isKey: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <p className="text-zinc-600 dark:text-zinc-400">
        Put the strap on, wet the contacts, then connect. Keep this screen open while you ride.
        {isKey && ` Key session: finish by ${cutoff}.`}
      </p>
      <button type="button" onClick={hr.connect} disabled={hr.status === "connecting"} className={`${btn.base} ${btn.primary} h-14 text-base`}>
        <Bluetooth aria-hidden size={20} className="mr-2" />
        {hr.status === "connecting" ? "Connecting…" : "Connect heart rate strap"}
      </button>
      {allowSimulator && (
        <button type="button" onClick={hr.simulate} className={`${btn.base} ${btn.secondary}`}>
          Use simulated heart rate
        </button>
      )}
      <ErrorText>{hr.error}</ErrorText>
    </div>
  );
}

function LinkState({ hr }: { hr: ReturnType<typeof useHeartRate> }) {
  if (hr.status === "live") {
    return <p className="text-sm text-zinc-500">Connected to {hr.deviceName}</p>;
  }
  if (hr.status === "reconnecting") {
    return <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Signal lost, reconnecting…</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ErrorText>{hr.error ?? "Not connected."}</ErrorText>
      <button type="button" onClick={hr.reconnect} className={`${btn.base} ${btn.secondary}`}>
        Reconnect
      </button>
    </div>
  );
}

/** Guitar-tuner style: big bpm, a band for the zone, and a needle. */
function Tuner({
  bpm,
  bounds,
  status,
  contact,
}: {
  bpm: number | null;
  bounds: Bounds | null;
  status: ZoneStatus | null;
  contact: boolean | null;
}) {
  const range = bounds ? gaugeRange(bounds) : ([90, 190] as [number, number]);
  const ui = status ? STATUS_UI[status] : null;
  const bandStart = bounds ? gaugePosition(bounds.low ?? range[0], range) : 0;
  const bandEnd = bounds ? gaugePosition(bounds.high ?? range[1], range) : 1;

  return (
    <section
      aria-live="polite"
      className={`flex flex-col items-center gap-3 rounded-2xl p-5 transition-colors ${ui?.panel ?? "bg-zinc-200 dark:bg-zinc-800"}`}
    >
      <div className="flex items-center gap-2 text-lg font-semibold">
        {ui && <ui.Icon aria-hidden size={24} />}
        {contact === false ? "No skin contact" : (ui?.text ?? "Waiting for heart rate…")}
      </div>
      <div className="font-mono text-7xl font-bold tabular-nums leading-none">
        {bpm ?? "--"}
        <span className="ml-1 text-xl font-medium opacity-80">bpm</span>
      </div>

      <div className="relative mt-2 h-6 w-full overflow-hidden rounded-full bg-black/20">
        <div
          className="absolute inset-y-0 bg-white/50"
          style={{ left: `${bandStart * 100}%`, width: `${(bandEnd - bandStart) * 100}%` }}
        />
        {bpm !== null && (
          <div
            className="absolute inset-y-[-2px] w-1.5 -translate-x-1/2 rounded-full bg-white shadow transition-[left] duration-700"
            style={{ left: `${gaugePosition(bpm, range) * 100}%` }}
          />
        )}
      </div>
      {bounds && (
        <p className="text-sm opacity-90">
          Target {bounds.label}:{" "}
          {bounds.low === null ? `up to ${bounds.high}` : bounds.high === null ? `${bounds.low}+` : `${bounds.low}–${bounds.high}`} bpm
        </p>
      )}
    </section>
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
      <SummaryTiles summary={summary} />

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

function SummaryTiles({ summary }: { summary: RideSummary }) {
  const tiles: [string, string | number][] = [
    ["Minutes", summary.minutes],
    ["Avg HR", summary.avgHr ?? "--"],
    ["In zone", `${summary.inZonePct ?? "--"}%`],
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 text-center">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-xs text-zinc-500">{label}</dt>
          <dd className="text-xl font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DemoSummary({ summary, zone }: { summary: RideSummary; zone: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <h1 className="text-2xl font-semibold">Demo finished</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Against {zone}. Nothing was saved.</p>
      <SummaryTiles summary={summary} />
      {/* Full reload so the strap connection and readings start fresh. */}
      <button type="button" onClick={() => window.location.reload()} className={`${btn.base} ${btn.primary} mt-auto`}>
        Try again
      </button>
      <Link href="/settings" className="text-center text-sm text-zinc-600 underline dark:text-zinc-400">
        Back to Settings
      </Link>
    </main>
  );
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Vibration pattern and optional tone: one long buzz/low tone = push on, three short/high = ease off. */
function signal(status: ZoneStatus, sound: boolean) {
  if (status === "in") return;
  if ("vibrate" in navigator) navigator.vibrate(status === "under" ? [600] : [150, 100, 150, 100, 150]);
  if (!sound) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = status === "under" ? 440 : 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => void ctx.close();
  } catch {
    // Audio not available; vibration is enough.
  }
}
