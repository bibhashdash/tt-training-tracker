"use client";

import { Bike, Bluetooth, HeartPulse, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { saveSessionLog } from "@/app/actions/logs";
import { btn, Card, ErrorText, Segmented } from "@/components/ui";
import type { IsoDate, Weekday } from "@/lib/dates";
import {
  classify,
  isValidThreshold,
  simTargets,
  smoothed,
  stepNudge,
  summarize,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  zoneBounds,
  zonesFromThreshold,
  type Bounds,
  type NudgeState,
  type RideSummary,
  type Sample,
  type ZoneTable,
} from "@/lib/hr";
import {
  FTP_MAX,
  FTP_MIN,
  isValidFtp,
  POWER_ZONE_NAMES,
  POWER_ZONES,
  powerBounds,
  powerZonesFromFtp,
  rollingPower,
  summarizePower,
  type PowerSample,
  type PowerSummary,
  type PowerZone,
  type PowerZoneTable,
} from "@/lib/power";
import { BIKES, capFor, defaultBike, type Bike as BikeType, type SlotUsed } from "@/lib/session-rules";
import type { PlannedSession } from "@/lib/types";
import { clock, LinkState, signal, SimButtons, Tiles, Tuner, ZoneNumberField } from "./tuner-ui";
import { useHeartRate, useWakeLock } from "./use-heart-rate";
import { useTrainer } from "./use-trainer";

/**
 * What the screen is for:
 *  - planned: one of today's planned rides; saving logs that session.
 *  - free:    a ride started from the Today button; saved as an unplanned ride,
 *             or as today's planned ride if there's one left to log.
 *  - demo:    public practice; the visitor enters threshold HR and FTP; nothing is saved.
 */
export type RideMode =
  | { kind: "planned"; session: PlannedSession; date: IsoDate; dateLabel: string; weekday: Weekday; cutoff: string }
  | { kind: "free"; date: IsoDate; dateLabel: string; weekday: Weekday; todaysRide: PlannedSession | null }
  | { kind: "demo"; exitHref: string };

type Metric = "hr" | "power";
const RECOVERY = "Z1-2";
const FREE_HR_ZONES = ["Z1-2", "Z2", "Z3", "Z4"];

interface RideResult {
  minutes: number;
  hr: RideSummary | null;
  hrZone: string;
  power: PowerSummary | null;
  usedTrainer: boolean;
}

/** Summary of the ride from the readings collected so far (called on Finish/Stop, never during render). */
function buildResult(
  hrSamples: Sample[],
  powerSamples: PowerSample[],
  startedAt: number | null,
  hrBounds: Bounds | null,
  hrZone: string,
  pZones: PowerZoneTable | null,
): RideResult {
  const end = Date.now();
  const start = startedAt ?? end;
  return {
    minutes: Math.max(1, Math.round((end - start) / 60_000)),
    hr: hrSamples.length ? summarize(hrSamples, start, end, hrBounds) : null,
    hrZone,
    power: pZones && powerSamples.length ? summarizePower(powerSamples, end, pZones) : null,
    usedTrainer: powerSamples.length > 0,
  };
}

function hrRows(z: ZoneTable) {
  return ([1, 2, 3, 4, 5] as const).map((n) => ({
    zone: `Z${n}`,
    range: n === 1 ? `<${z[2][0]}` : n === 5 ? `${z[5][0]}+` : `${z[n][0]}–${z[n][1]}`,
  }));
}

function powerRows(z: PowerZoneTable) {
  return POWER_ZONES.map((n) => ({
    zone: `Z${n}`,
    range: n === 1 ? `<${z[2][0]}` : n === 6 ? `${z[6][0]}+` : `${z[n][0]}–${z[n][1]}`,
  }));
}

/**
 * Live ride: heart rate strap and/or smart trainer (read-only), a tuner that
 * follows heart rate or power, vibration nudges, and a summary at the end.
 */
export function LiveRideScreen({
  mode,
  threshold: initialThreshold,
  ftp: initialFtp,
  allowSimulator,
}: {
  mode: RideMode;
  /** Settings values for real rides; prefills (or null) in the demo, where they're editable. */
  threshold: number | null;
  ftp: number | null;
  allowSimulator: boolean;
}) {
  const hr = useHeartRate();
  const trainer = useTrainer();
  const isDemo = mode.kind === "demo";
  const session = mode.kind === "planned" ? mode.session : null;
  const [thresholdInput, setThresholdInput] = useState(initialThreshold ? String(initialThreshold) : "");
  const [ftpInput, setFtpInput] = useState(initialFtp ? String(initialFtp) : "");
  const [hrZone, setHrZone] = useState(session ? (session.zone ?? RECOVERY) : "Z2");
  const [powerZone, setPowerZone] = useState<PowerZone>(2);
  const [metric, setMetric] = useState<Metric>("hr");
  const [sound, setSound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<RideResult | null>(null);
  const nudge = useRef<NudgeState | null>(null);

  const threshold = Number(thresholdInput);
  const ftp = Number(ftpInput);
  const hrZones = isValidThreshold(threshold) ? zonesFromThreshold(threshold) : null;
  const pZones = isValidFtp(ftp) ? powerZonesFromFtp(ftp) : null;

  const hrActive = hr.firstAt !== null || hr.status === "live" || hr.status === "reconnecting";
  const trainerActive = trainer.firstAt !== null || trainer.status === "live" || trainer.status === "reconnecting";
  const started = hrActive || trainerActive;
  const firsts = [hr.firstAt, trainer.firstAt].filter((t): t is number => t !== null);
  const startedAt = firsts.length ? Math.min(...firsts) : null;
  // The tuner follows the chosen metric when its source is on, otherwise whichever is.
  const tunerMetric: Metric = metric === "hr" ? (hrActive ? "hr" : "power") : trainerActive ? "power" : "hr";

  useWakeLock(started && !result);

  useEffect(() => {
    if (startedAt === null || result) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, result]);

  useEffect(() => {
    if (!started || result) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [started, result]);

  const hrBounds = hrZones ? zoneBounds(hrZone, hrZones) : null;
  const pBounds = pZones ? powerBounds(powerZone, pZones) : null;
  const bpm = hr.latest ? smoothed(hr.samples.current, now) : null;
  const watts = trainer.latest ? rollingPower(trainer.samples.current, now) : null;
  const value = tunerMetric === "hr" ? bpm : watts;
  const bounds = tunerMetric === "hr" ? hrBounds : pBounds;
  const status = value !== null && bounds ? classify(value, bounds) : null;

  useEffect(() => {
    if (!status || result) return;
    const r = stepNudge(nudge.current, status, now);
    nudge.current = r.state;
    if (r.nudge) signal(status, sound);
  }, [status, now, sound, result]);

  // Planned key sessions (intervals) can switch between their effort zone and recovery.
  const hrZoneChoices = useMemo(() => {
    if (!session) return FREE_HR_ZONES;
    const zones = [session.zone ?? RECOVERY];
    if (session.is_key && session.zone !== RECOVERY) zones.push(RECOVERY);
    return zones;
  }, [session]);

  const finish = () => {
    hr.disconnect();
    trainer.disconnect();
    // A planned ride's time in zone is judged against the session's zone, whatever was on the tuner.
    const summaryBounds = session && hrZones ? zoneBounds(session.zone, hrZones) : hrBounds;
    setResult(
      buildResult(hr.samples.current, trainer.samples.current, startedAt, summaryBounds, session?.zone ?? hrZone, pZones),
    );
  };

  if (result) {
    return mode.kind === "demo" ? (
      <DemoResultView result={result} exitHref={mode.exitHref} />
    ) : (
      <SaveRide mode={mode} result={result} />
    );
  }

  const exitHref = mode.kind === "demo" ? mode.exitHref : "/today";

  const hrCard = (
    <SourceCard
      icon={<HeartPulse aria-hidden size={20} />}
      title="Heart rate strap"
      note={isDemo ? undefined : "Put the strap on and wet the contacts first."}
      field={
        isDemo ? (
          <ZoneNumberField
            id="threshold"
            label="Threshold heart rate"
            unit="bpm"
            placeholder="e.g. 170"
            help="The highest heart rate you can hold for about an hour: roughly your average over the last 20 minutes of a hard, steady 30-minute effort. Not sure? About 90% of your maximum is a reasonable start."
            value={thresholdInput}
            onChange={setThresholdInput}
            rows={hrZones ? hrRows(hrZones) : null}
            invalidText={`Enter a whole number from ${THRESHOLD_MIN} to ${THRESHOLD_MAX}.`}
          />
        ) : null
      }
      ready={hrZones !== null}
      notReadyText="Enter your threshold heart rate to connect."
      connecting={hr.status === "connecting"}
      connectLabel="Connect heart rate strap"
      onConnect={hr.connect}
      simulateLabel={allowSimulator ? "Use simulated heart rate" : null}
      onSimulate={() => {
        hr.simulate();
        if (hrBounds) hr.setSimTarget(simTargets(hrBounds).in);
      }}
      error={hr.error}
    />
  );

  const trainerCard = (
    <SourceCard
      icon={<Bike aria-hidden size={20} />}
      title="Smart trainer"
      note="Optional. Read-only: the app never changes your trainer's resistance."
      field={
        isDemo ? (
          <ZoneNumberField
            id="ftp"
            label="FTP"
            unit="W"
            placeholder="e.g. 200"
            help="Functional threshold power: roughly the average power you can hold for an hour, often estimated as 95% of a 20-minute all-out effort."
            value={ftpInput}
            onChange={setFtpInput}
            rows={pZones ? powerRows(pZones) : null}
            invalidText={`Enter a whole number from ${FTP_MIN} to ${FTP_MAX}.`}
          />
        ) : null
      }
      ready={pZones !== null}
      notReadyText="Enter your FTP to connect."
      connecting={trainer.status === "connecting"}
      connectLabel="Connect smart trainer"
      onConnect={trainer.connect}
      simulateLabel={allowSimulator ? "Use simulated trainer" : null}
      onSimulate={() => {
        trainer.simulate();
        if (pBounds) trainer.setSimTarget(simTargets(pBounds).in);
      }}
      error={trainer.error}
    />
  );

  const secondary: [string, string | number][] = [];
  if (hrActive && tunerMetric !== "hr") secondary.push(["Heart rate", bpm ?? "--"]);
  if (trainerActive && tunerMetric !== "power") secondary.push(["Power (3 s)", watts ?? "--"]);
  if (trainerActive) {
    secondary.push(["Cadence", trainer.latest?.cadence ?? "--"]);
    secondary.push(["Speed", trainer.latest?.speed ?? "--"]);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <header className="flex items-start justify-between gap-3">
        <RideHeader mode={mode} />
        {!started && (
          <Link href={exitHref} aria-label="Close" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center">
            <X aria-hidden size={22} />
          </Link>
        )}
      </header>

      {!started ? (
        <>
          {!isDemo && hrZones && pZones && (
            <p className="-mt-2 text-xs text-zinc-500">
              Zones from your settings: threshold {threshold} bpm, FTP {ftp} W.
            </p>
          )}
          {hrCard}
          {trainerCard}
          <p className="text-center text-xs text-zinc-500">
            Use either or both. The clock starts with the first reading. Keep this screen open while you ride.
            {mode.kind === "planned" && mode.session.is_key && ` Key session: finish by ${mode.cutoff}.`}
          </p>
        </>
      ) : (
        <>
          {hrActive && trainerActive && (
            <Segmented
              label="Tuner follows"
              value={metric}
              options={[
                { value: "hr", label: "Heart rate" },
                { value: "power", label: "Power" },
              ]}
              onChange={(m) => {
                setMetric(m);
                nudge.current = null;
              }}
            />
          )}

          {tunerMetric === "hr"
            ? hrZoneChoices.length > 1 && (
                <Segmented
                  label="Heart rate zone"
                  value={hrZone}
                  options={hrZoneChoices.map((z) => ({
                    value: z,
                    label: session ? (z === RECOVERY ? `Recovery ${z}` : `Effort ${z}`) : z,
                  }))}
                  onChange={(z) => {
                    setHrZone(z);
                    nudge.current = null;
                  }}
                />
              )
            : (
                <Segmented
                  label="Power zone"
                  value={powerZone}
                  columns={6}
                  options={POWER_ZONES.map((z) => ({ value: z, label: `Z${z}` }))}
                  onChange={(z) => {
                    setPowerZone(z);
                    nudge.current = null;
                  }}
                />
              )}

          <Tuner
            value={value}
            unit={tunerMetric === "hr" ? "bpm" : "W"}
            bounds={bounds}
            status={status}
            waiting={tunerMetric === "hr" ? "Waiting for heart rate…" : "Waiting for power…"}
            warning={tunerMetric === "hr" && hr.latest?.contact === false ? "No skin contact" : null}
          />
          {tunerMetric === "power" && (
            <p className="-mt-2 text-center text-xs text-zinc-500">
              Z{powerZone} {POWER_ZONE_NAMES[powerZone]} · power is a 3-second average
            </p>
          )}

          {secondary.length > 0 && <Tiles tiles={secondary} columns={Math.min(secondary.length, 3)} />}

          <div className="flex items-baseline justify-between">
            <span className="font-mono text-4xl font-semibold tabular-nums">
              {clock(startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000)))}
            </span>
            {session && <span className="text-sm text-zinc-500">of {session.target_minutes}:00</span>}
          </div>

          {hrActive && (
            <SourceStatus label="Strap">
              <LinkState link={hr} />
              {hr.deviceName === "Simulated strap" && hrBounds && (
                <SimButtons bounds={hrBounds} unit="bpm" onTarget={hr.setSimTarget} />
              )}
            </SourceStatus>
          )}
          {trainerActive && (
            <SourceStatus
              label={`Trainer${trainer.protocol && trainer.protocol !== "Simulated" ? ` · ${trainer.protocol}` : ""}`}
            >
              <LinkState link={trainer} lostText="Trainer signal lost, reconnecting…" />
              {trainer.deviceName === "Simulated trainer" && pBounds && (
                <SimButtons bounds={pBounds} unit="W" onTarget={trainer.setSimTarget} />
              )}
            </SourceStatus>
          )}

          {!hrActive && <AddLater title="Add a heart rate strap">{hrCard}</AddLater>}
          {!trainerActive && <AddLater title="Add a smart trainer">{trainerCard}</AddLater>}

          <label className="flex items-center justify-between text-sm">
            <span>Beep as well as vibrate</span>
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} className="h-5 w-5" />
          </label>

          <button type="button" onClick={finish} className={`${btn.base} ${btn.primary} mt-auto`}>
            {isDemo ? "Stop" : "Finish ride"}
          </button>
        </>
      )}
    </main>
  );
}

function RideHeader({ mode }: { mode: RideMode }) {
  if (mode.kind === "demo") {
    return (
      <div>
        <h1 className="text-xl font-semibold">Live zones demo</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Heart rate strap, smart trainer, or both. Nothing is saved.</p>
      </div>
    );
  }
  if (mode.kind === "free") {
    return (
      <div>
        <p className="text-sm text-zinc-500">{mode.dateLabel}</p>
        <h1 className="text-xl font-semibold">Free ride</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {mode.todaysRide
            ? "At the end you can count it as today's planned ride, or log it as unplanned."
            : "Logged as an unplanned ride: on the record, but it doesn't count toward the week."}
        </p>
      </div>
    );
  }
  const s = mode.session;
  return (
    <div>
      <p className="text-sm text-zinc-500">{mode.dateLabel}</p>
      <h1 className="text-xl font-semibold">
        Ride · {s.target_minutes} min · {s.zone ?? "easy"}
      </h1>
      {s.description && <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.description}</p>}
    </div>
  );
}

function SourceCard({
  icon,
  title,
  note,
  field,
  ready,
  notReadyText,
  connecting,
  connectLabel,
  onConnect,
  simulateLabel,
  onSimulate,
  error,
}: {
  icon: ReactNode;
  title: string;
  note?: string;
  field: ReactNode;
  ready: boolean;
  notReadyText: string;
  connecting: boolean;
  connectLabel: string;
  onConnect: () => void;
  /** Null hides the simulator button. */
  simulateLabel: string | null;
  onSimulate: () => void;
  error: string | null;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <p className="flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </p>
      {note && <p className="-mt-2 text-xs text-zinc-500">{note}</p>}
      {field}
      <button type="button" onClick={onConnect} disabled={!ready || connecting} className={`${btn.base} ${btn.primary}`}>
        <Bluetooth aria-hidden size={18} className="mr-2" />
        {connecting ? "Connecting…" : connectLabel}
      </button>
      {simulateLabel && (
        <button type="button" onClick={onSimulate} disabled={!ready} className={`${btn.base} ${btn.secondary}`}>
          {simulateLabel}
        </button>
      )}
      {!ready && <p className="text-center text-xs text-zinc-500">{notReadyText}</p>}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function SourceStatus({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
      {children}
    </div>
  );
}

function AddLater({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none text-sm text-zinc-600 dark:text-zinc-400">+ {title}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

const ZONE_COLOURS: Record<PowerZone, string> = {
  1: "bg-zinc-400",
  2: "bg-sky-500",
  3: "bg-emerald-500",
  4: "bg-amber-500",
  5: "bg-orange-600",
  6: "bg-red-600",
};

function resultTiles(result: RideResult): [string, string | number][] {
  const tiles: [string, string | number][] = [["Minutes", result.minutes]];
  if (result.hr) {
    tiles.push(["Avg HR", result.hr.avgHr ?? "--"]);
    tiles.push([`HR in ${result.hrZone}`, `${result.hr.inZonePct ?? "--"}%`]);
  }
  if (result.power) {
    tiles.push(["Avg power", `${result.power.avgPower} W`]);
    tiles.push(["Avg cadence", result.power.avgCadence ?? "--"]);
  }
  return tiles;
}

function PowerZoneBar({ power }: { power: PowerSummary }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="text-sm font-medium">Time in power zones</p>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        {POWER_ZONES.map((z) =>
          power.zonePct[z] > 0 ? (
            <div key={z} className={ZONE_COLOURS[z]} style={{ width: `${power.zonePct[z]}%` }} title={`Z${z} ${power.zonePct[z]}%`} />
          ) : null,
        )}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {POWER_ZONES.map((z) => (
          <li key={z} className="flex items-center gap-1.5">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${ZONE_COLOURS[z]}`} />
            Z{z} {POWER_ZONE_NAMES[z]} <span className="ml-auto tabular-nums text-zinc-500">{power.zonePct[z]}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DemoResultView({ result, exitHref }: { result: RideResult; exitHref: string }) {
  const tiles = resultTiles(result);
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <h1 className="text-2xl font-semibold">Demo finished</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing was saved.</p>
      <Tiles tiles={tiles} columns={tiles.length > 3 ? 2 : tiles.length} />
      {result.power && <PowerZoneBar power={result.power} />}
      {/* Full reload so the Bluetooth connections and readings start fresh. */}
      <button type="button" onClick={() => window.location.reload()} className={`${btn.base} ${btn.primary} mt-auto`}>
        Try again
      </button>
      <Link href={exitHref} className="text-center text-sm text-zinc-600 underline dark:text-zinc-400">
        Back
      </Link>
    </main>
  );
}

/** End of a real ride: confirm minutes, slot and bike, then log it. */
function SaveRide({ mode, result }: { mode: Extract<RideMode, { kind: "planned" | "free" }>; result: RideResult }) {
  const router = useRouter();
  const plannedOption = mode.kind === "planned" ? mode.session : mode.todaysRide;
  const [asPlanned, setAsPlanned] = useState(plannedOption !== null);
  const [minutes, setMinutes] = useState(result.minutes);
  const [slot, setSlot] = useState<SlotUsed>("primary");
  const [bike, setBike] = useState<BikeType>(result.usedTrainer ? "turbo_road" : defaultBike(mode.weekday));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const session = asPlanned ? plannedOption : null;
  const cap = session ? capFor(session, slot, bike) : null;
  const tiles = resultTiles(result);

  const save = () =>
    startTransition(async () => {
      const r = await saveSessionLog({
        date: mode.date,
        plannedSessionId: session?.id ?? null,
        status: "done",
        slotUsed: session ? slot : "other",
        actualMinutes: minutes,
        avgHr: result.hr?.avgHr ?? null,
        avgPower: result.power?.avgPower ?? null,
        avgCadence: result.power?.avgCadence ?? null,
        rpe: null,
        bike,
        notes: result.hr?.inZonePct != null ? `${result.hr.inZonePct}% in ${result.hrZone} (recorded live)` : null,
      });
      if (r.ok) router.push("/today");
      else setError(r.error ?? "Couldn't save.");
    });

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <h1 className="text-2xl font-semibold">Ride done</h1>
      <Tiles tiles={tiles} columns={tiles.length > 3 ? 2 : tiles.length} />
      {result.power && <PowerZoneBar power={result.power} />}

      {mode.kind === "free" && mode.todaysRide && (
        <div>
          <span className="mb-1 block text-xs font-medium text-zinc-500">Log as</span>
          <Segmented
            label="Log as"
            value={asPlanned ? "planned" : "unplanned"}
            options={[
              { value: "planned", label: `Today's ride (${mode.todaysRide.target_minutes} min)` },
              { value: "unplanned", label: "Unplanned ride" },
            ]}
            onChange={(v) => setAsPlanned(v === "planned")}
          />
          {!asPlanned && (
            <p className="mt-1 text-xs text-zinc-500">Unplanned rides are on the record but don&apos;t count toward the week.</p>
          )}
        </div>
      )}

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
      {session && (
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
      )}
      <div>
        <span className="mb-1 block text-xs font-medium text-zinc-500">Bike</span>
        <Segmented label="Bike" value={bike} options={BIKES} onChange={setBike} />
      </div>

      <ErrorText>{error}</ErrorText>
      <button type="button" onClick={save} disabled={pending || minutes < 1} className={`${btn.base} ${btn.primary} mt-auto`}>
        {pending ? "Saving…" : "Save ride"}
      </button>
      <Link href="/today" className="text-center text-sm text-zinc-600 underline dark:text-zinc-400">
        Discard and go back
      </Link>
    </main>
  );
}
