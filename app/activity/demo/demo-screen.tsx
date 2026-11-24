"use client";

import { Bike, Bluetooth, HeartPulse, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { btn, Card, ErrorText, Segmented } from "@/components/ui";
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
import { useHeartRate, useWakeLock } from "../[sessionId]/use-heart-rate";
import { useTrainer } from "../[sessionId]/use-trainer";
import { clock, LinkState, signal, SimButtons, Tiles, Tuner, ZoneNumberField } from "../tuner-ui";

type Metric = "hr" | "power";
const HR_ZONES = ["Z1-2", "Z2", "Z3", "Z4"];

interface DemoResult {
  minutes: number;
  hr: RideSummary | null;
  hrZone: string;
  power: PowerSummary | null;
}

/** Summary of a demo ride, from the readings collected up to now (called on Stop). */
function buildResult(
  hrSamples: Sample[],
  powerSamples: PowerSample[],
  startedAt: number | null,
  hrBounds: Bounds | null,
  hrZone: string,
  pZones: PowerZoneTable | null,
): DemoResult {
  const end = Date.now();
  const start = startedAt ?? end;
  return {
    minutes: Math.max(1, Math.round((end - start) / 60_000)),
    hr: hrSamples.length ? summarize(hrSamples, start, end, hrBounds) : null,
    hrZone,
    power: pZones ? summarizePower(powerSamples, end, pZones) : null,
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
 * Practice screen, open without signing in: a heart rate strap and/or a smart
 * trainer (read-only), zones from the threshold HR and FTP entered. Nothing is saved.
 */
export function DemoScreen({
  exitHref,
  defaultThreshold,
  defaultFtp,
}: {
  exitHref: string;
  defaultThreshold: number | null;
  defaultFtp: number | null;
}) {
  const hr = useHeartRate();
  const trainer = useTrainer();
  const [thresholdInput, setThresholdInput] = useState(defaultThreshold ? String(defaultThreshold) : "");
  const [ftpInput, setFtpInput] = useState(defaultFtp ? String(defaultFtp) : "");
  const [hrZone, setHrZone] = useState("Z2");
  const [powerZone, setPowerZone] = useState<PowerZone>(2);
  const [metric, setMetric] = useState<Metric>("hr");
  const [sound, setSound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<DemoResult | null>(null);
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

  const stop = () => {
    hr.disconnect();
    trainer.disconnect();
    setResult(buildResult(hr.samples.current, trainer.samples.current, startedAt, hrBounds, hrZone, pZones));
  };

  if (result) return <DemoResultView result={result} exitHref={exitHref} />;

  const hrCard = (
    <SourceCard
      icon={<HeartPulse aria-hidden size={20} />}
      title="Heart rate strap"
      field={
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
      }
      ready={hrZones !== null}
      notReadyText="Enter your threshold heart rate to connect."
      connecting={hr.status === "connecting"}
      connectLabel="Connect heart rate strap"
      onConnect={hr.connect}
      onSimulate={() => {
        hr.simulate();
        if (hrBounds) hr.setSimTarget(simTargets(hrBounds).in);
      }}
      simulateLabel="Use simulated heart rate"
      error={hr.error}
    />
  );

  const trainerCard = (
    <SourceCard
      icon={<Bike aria-hidden size={20} />}
      title="Smart trainer"
      note="Read-only: the app never changes your trainer's resistance."
      field={
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
      }
      ready={pZones !== null}
      notReadyText="Enter your FTP to connect."
      connecting={trainer.status === "connecting"}
      connectLabel="Connect smart trainer"
      onConnect={trainer.connect}
      onSimulate={() => {
        trainer.simulate();
        if (pBounds) trainer.setSimTarget(simTargets(pBounds).in);
      }}
      simulateLabel="Use simulated trainer"
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
        <div>
          <h1 className="text-xl font-semibold">Live zones demo</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Heart rate strap, smart trainer, or both. Nothing is saved.
          </p>
        </div>
        {!started && (
          <Link href={exitHref} aria-label="Close" className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center">
            <X aria-hidden size={22} />
          </Link>
        )}
      </header>

      {!started ? (
        <>
          {hrCard}
          {trainerCard}
          <p className="text-center text-xs text-zinc-500">
            Use either or both. The clock starts with the first reading. Keep this screen open while you ride.
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

          {tunerMetric === "hr" ? (
            <Segmented
              label="Heart rate zone"
              value={hrZone}
              options={HR_ZONES.map((z) => ({ value: z, label: z }))}
              onChange={(z) => {
                setHrZone(z);
                nudge.current = null;
              }}
            />
          ) : (
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

          <span className="font-mono text-4xl font-semibold tabular-nums">{clock(startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000)))}</span>

          {hrActive && (
            <SourceStatus label="Strap">
              <LinkState link={hr} />
              {hr.deviceName === "Simulated strap" && hrBounds && (
                <SimButtons bounds={hrBounds} unit="bpm" onTarget={hr.setSimTarget} />
              )}
            </SourceStatus>
          )}
          {trainerActive && (
            <SourceStatus label={`Trainer${trainer.protocol && trainer.protocol !== "Simulated" ? ` · ${trainer.protocol}` : ""}`}>
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

          <button type="button" onClick={stop} className={`${btn.base} ${btn.primary} mt-auto`}>
            Stop
          </button>
        </>
      )}
    </main>
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
  onSimulate,
  simulateLabel,
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
  onSimulate: () => void;
  simulateLabel: string;
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
      <button type="button" onClick={onSimulate} disabled={!ready} className={`${btn.base} ${btn.secondary}`}>
        {simulateLabel}
      </button>
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

function DemoResultView({ result, exitHref }: { result: DemoResult; exitHref: string }) {
  const tiles: [string, string | number][] = [["Minutes", result.minutes]];
  if (result.hr) {
    tiles.push(["Avg HR", result.hr.avgHr ?? "--"]);
    tiles.push([`HR in ${result.hrZone}`, `${result.hr.inZonePct ?? "--"}%`]);
  }
  if (result.power) {
    tiles.push(["Avg power", `${result.power.avgPower} W`]);
    tiles.push(["Avg cadence", result.power.avgCadence ?? "--"]);
  }
  const p = result.power;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      <h1 className="text-2xl font-semibold">Demo finished</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Nothing was saved.</p>
      <Tiles tiles={tiles} columns={tiles.length > 3 ? 2 : tiles.length} />

      {p && (
        <section className="flex flex-col gap-2">
          <p className="text-sm font-medium">Time in power zones</p>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            {POWER_ZONES.map((z) =>
              p.zonePct[z] > 0 ? (
                <div key={z} className={ZONE_COLOURS[z]} style={{ width: `${p.zonePct[z]}%` }} title={`Z${z} ${p.zonePct[z]}%`} />
              ) : null,
            )}
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {POWER_ZONES.map((z) => (
              <li key={z} className="flex items-center gap-1.5">
                <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${ZONE_COLOURS[z]}`} />
                Z{z} {POWER_ZONE_NAMES[z]} <span className="ml-auto tabular-nums text-zinc-500">{p.zonePct[z]}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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

