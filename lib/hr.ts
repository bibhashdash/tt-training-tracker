// Live heart rate: parse the Bluetooth signal, work out the target band for a
// session's zone, smooth readings, decide when to nudge, and summarise a ride.
// Pure and unit-tested; the Activity screen wires it to the strap.

/** bpm bounds per zone (threshold about 172). Matches hrZone() in session-rules. */
export const ZONE_BPM: Record<1 | 2 | 3 | 4 | 5, [number, number]> = {
  1: [0, 138],
  2: [139, 154],
  3: [155, 161],
  4: [162, 171],
  5: [172, 250],
};

export interface Reading {
  bpm: number;
  /** Strap reports skin contact; null if it doesn't say. */
  contact: boolean | null;
}

/**
 * Standard Bluetooth Heart Rate Measurement (characteristic 0x2A37).
 * Byte 0 is flags: bit 0 = 16-bit value, bit 1 = contact detected, bit 2 = contact supported.
 */
export function parseHeartRate(view: DataView): Reading | null {
  if (view.byteLength < 2) return null;
  const flags = view.getUint8(0);
  const wide = (flags & 0x01) !== 0;
  if (wide && view.byteLength < 3) return null;
  const bpm = wide ? view.getUint16(1, true) : view.getUint8(1);
  const contact = (flags & 0x04) !== 0 ? (flags & 0x02) !== 0 : null;
  return { bpm, contact };
}

export interface Bounds {
  /** Lowest bpm still in zone; null = no floor (easy zones). */
  low: number | null;
  /** Highest bpm still in zone; null = no ceiling. */
  high: number | null;
  label: string;
}

/** "Z1-2" -> no floor, ceiling 154. "Z3" -> 155-161. Null if the zone can't be read. */
export function zoneBounds(zone: string | null): Bounds | null {
  const m = zone?.match(/Z([1-5])(?:-([1-5]))?/i);
  if (!m) return null;
  const from = Number(m[1]) as 1 | 2 | 3 | 4 | 5;
  const to = Number(m[2] ?? m[1]) as 1 | 2 | 3 | 4 | 5;
  if (to < from) return null;
  return {
    low: from === 1 ? null : ZONE_BPM[from][0],
    high: to === 5 ? null : ZONE_BPM[to][1],
    label: from === to ? `Z${from}` : `Z${from}-${to}`,
  };
}

export type ZoneStatus = "under" | "in" | "over";

export function classify(bpm: number, b: Bounds): ZoneStatus {
  if (b.high !== null && bpm > b.high) return "over";
  if (b.low !== null && bpm < b.low) return "under";
  return "in";
}

export interface Sample {
  t: number; // ms
  bpm: number;
}

/** Mean of the readings in the last `windowMs`, so the display doesn't jump on every beat. */
export function smoothed(samples: Sample[], now: number, windowMs = 5000): number | null {
  let sum = 0;
  let n = 0;
  for (let i = samples.length - 1; i >= 0 && samples[i].t > now - windowMs; i--) {
    sum += samples[i].bpm;
    n++;
  }
  return n === 0 ? null : Math.round(sum / n);
}

export interface NudgeState {
  status: ZoneStatus;
  since: number;
  lastNudgeAt: number | null;
}

/**
 * Nudge (vibrate/beep) once you've been out of zone for `afterMs`, then at most
 * every `repeatMs` while you stay out. Coming back into zone resets it.
 */
export function stepNudge(
  prev: NudgeState | null,
  status: ZoneStatus,
  now: number,
  afterMs = 10_000,
  repeatMs = 30_000,
): { state: NudgeState; nudge: boolean } {
  if (!prev || prev.status !== status) {
    return { state: { status, since: now, lastNudgeAt: null }, nudge: false };
  }
  if (status === "in") return { state: prev, nudge: false };
  const due =
    now - prev.since >= afterMs && (prev.lastNudgeAt === null || now - prev.lastNudgeAt >= repeatMs);
  return { state: due ? { ...prev, lastNudgeAt: now } : prev, nudge: due };
}

/** The slice of bpm the gauge shows, with some room either side of the band. */
export function gaugeRange(b: Bounds): [number, number] {
  const low = b.low ?? (b.high ?? 150) - 40;
  const high = b.high ?? (b.low ?? 150) + 30;
  return [low - 15, high + 15];
}

/** 0..1 position of `bpm` on the gauge, clamped. */
export function gaugePosition(bpm: number, [min, max]: [number, number]): number {
  return Math.min(1, Math.max(0, (bpm - min) / (max - min)));
}

export interface RideSummary {
  minutes: number;
  avgHr: number | null;
  /** Share of time (by readings) inside the target band, 0-100. */
  inZonePct: number | null;
}

/**
 * Summarise a ride. Time between readings is capped at 5 s so a dropout
 * doesn't count as minutes in (or out of) zone.
 */
export function summarize(samples: Sample[], startedAt: number, endedAt: number, bounds: Bounds | null): RideSummary {
  const minutes = Math.max(1, Math.round((endedAt - startedAt) / 60_000));
  if (samples.length === 0) return { minutes, avgHr: null, inZonePct: null };

  let weight = 0;
  let weighted = 0;
  let inZone = 0;
  for (let i = 0; i < samples.length; i++) {
    const next = samples[i + 1]?.t ?? endedAt;
    const dt = Math.min(5000, Math.max(0, next - samples[i].t)) || 1;
    weight += dt;
    weighted += samples[i].bpm * dt;
    if (bounds && classify(samples[i].bpm, bounds) === "in") inZone += dt;
  }
  return {
    minutes,
    avgHr: Math.round(weighted / weight),
    inZonePct: bounds ? Math.round((inZone / weight) * 100) : null,
  };
}
