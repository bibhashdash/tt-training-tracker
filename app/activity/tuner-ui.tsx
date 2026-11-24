"use client";

// Shared pieces of the live activity screens (real ride and demo): the tuner,
// connection status, simulator presets, summary tiles, zone table and nudges.
import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { btn, ErrorText } from "@/components/ui";
import { gaugePosition, gaugeRange, simTargets, type Bounds, type ZoneStatus } from "@/lib/hr";
import type { LinkStatus } from "./[sessionId]/use-heart-rate";

export const STATUS_UI: Record<ZoneStatus, { text: string; panel: string; Icon: typeof Check }> = {
  under: { text: "Push on", panel: "bg-sky-600 text-white", Icon: ArrowUp },
  in: { text: "In zone", panel: "bg-emerald-600 text-white", Icon: Check },
  over: { text: "Ease off", panel: "bg-red-600 text-white", Icon: ArrowDown },
};

/** Guitar-tuner style: a big number, a band for the zone, and a needle. */
export function Tuner({
  value,
  unit,
  bounds,
  status,
  waiting,
  warning,
}: {
  value: number | null;
  unit: string;
  bounds: Bounds | null;
  status: ZoneStatus | null;
  /** Shown until the first reading, e.g. "Waiting for heart rate…". */
  waiting: string;
  /** Overrides the status text, e.g. "No skin contact". */
  warning?: string | null;
}) {
  const range = bounds ? gaugeRange(bounds) : ([0, 100] as [number, number]);
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
        {warning ?? ui?.text ?? waiting}
      </div>
      <div className="font-mono text-7xl font-bold tabular-nums leading-none">
        {value ?? "--"}
        <span className="ml-1 text-xl font-medium opacity-80">{unit}</span>
      </div>

      <div className="relative mt-2 h-6 w-full overflow-hidden rounded-full bg-black/20">
        <div
          className="absolute inset-y-0 bg-white/50"
          style={{ left: `${bandStart * 100}%`, width: `${(bandEnd - bandStart) * 100}%` }}
        />
        {value !== null && (
          <div
            className="absolute inset-y-[-2px] w-1.5 -translate-x-1/2 rounded-full bg-white shadow transition-[left] duration-700"
            style={{ left: `${gaugePosition(value, range) * 100}%` }}
          />
        )}
      </div>
      {bounds && (
        <p className="text-sm opacity-90">
          Target {bounds.label}:{" "}
          {bounds.low === null ? `up to ${bounds.high}` : bounds.high === null ? `${bounds.low}+` : `${bounds.low}–${bounds.high}`}{" "}
          {unit}
        </p>
      )}
    </section>
  );
}

export interface SensorLink {
  status: LinkStatus;
  error: string | null;
  deviceName: string | null;
  reconnect: () => void;
}

export function LinkState({ link, lostText = "Signal lost, reconnecting…" }: { link: SensorLink; lostText?: string }) {
  if (link.status === "live") {
    return <p className="text-sm text-zinc-500">Connected to {link.deviceName}</p>;
  }
  if (link.status === "reconnecting") {
    return <p className="text-sm font-medium text-amber-600 dark:text-amber-400">{lostText}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <ErrorText>{link.error ?? "Not connected."}</ErrorText>
      <button type="button" onClick={link.reconnect} className={`${btn.base} ${btn.secondary}`}>
        Reconnect
      </button>
    </div>
  );
}

/** Below / in / above presets for a simulated source, following the selected band. */
export function SimButtons({ bounds, unit, onTarget }: { bounds: Bounds; unit: string; onTarget: (v: number) => void }) {
  const t = simTargets(bounds);
  const presets: [string, number | null][] = [
    ["Sim below", t.under],
    ["Sim in zone", t.in],
    ["Sim above", t.over],
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {presets.map(([label, target]) => (
        <button
          key={label}
          type="button"
          disabled={target === null}
          onClick={() => target !== null && onTarget(target)}
          className={`${btn.base} ${btn.secondary} px-1 text-xs`}
        >
          {label}
          {target !== null && ` (${target}${unit === "W" ? " W" : ""})`}
        </button>
      ))}
    </div>
  );
}

export function Tiles({ tiles, columns = 3 }: { tiles: [string, string | number][]; columns?: number }) {
  return (
    <dl className="grid gap-2 text-center" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-xs text-zinc-500">{label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A number the demo needs (threshold HR, FTP) with help text and the zones it gives. */
export function ZoneNumberField({
  id,
  label,
  unit,
  placeholder,
  help,
  value,
  onChange,
  rows,
  invalidText,
}: {
  id: string;
  label: string;
  unit: string;
  placeholder: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  /** Zone ranges to show once the value is valid; null while it isn't. */
  rows: { zone: string; range: string }[] | null;
  invalidText: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between gap-3">
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-2">
          <input
            id={id}
            inputMode="numeric"
            aria-describedby={`${id}-help`}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 3))}
            className="h-11 w-24 rounded-lg border border-zinc-300 bg-transparent px-3 text-right text-base dark:border-zinc-700"
          />
          <span className="w-8 text-sm">{unit}</span>
        </span>
      </label>
      <p id={`${id}-help`} className="text-xs text-zinc-600 dark:text-zinc-400">
        {help}
      </p>
      {rows ? (
        <dl className="grid gap-1 text-center" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
          {rows.map((r) => (
            <div key={r.zone} className="rounded-lg bg-zinc-100 py-1.5 dark:bg-zinc-800">
              <dt className="text-xs font-semibold">{r.zone}</dt>
              <dd className="text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">{r.range}</dd>
            </div>
          ))}
        </dl>
      ) : (
        value !== "" && <ErrorText>{invalidText}</ErrorText>
      )}
    </div>
  );
}

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Vibration pattern and optional tone: one long buzz/low tone = push on, three short/high = ease off. */
export function signal(status: ZoneStatus, sound: boolean) {
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
