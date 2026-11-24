// Smart trainer data: power zones from FTP, decoders for the three Bluetooth
// formats trainers use, cadence, rolling averages and a ride summary.
// Pure and unit-tested; the activity screen wires it to the trainer.
import type { Bounds } from "./hr";

/** The rider's FTP, prefilled in the demo when signed in. */
export const DEFAULT_FTP = 160;
export const FTP_MIN = 50;
export const FTP_MAX = 600;

export function isValidFtp(n: number): boolean {
  return Number.isInteger(n) && n >= FTP_MIN && n <= FTP_MAX;
}

export type PowerZone = 1 | 2 | 3 | 4 | 5 | 6;
export type PowerZoneTable = Record<PowerZone, [number, number]>;
export const POWER_ZONES: PowerZone[] = [1, 2, 3, 4, 5, 6];
export const POWER_ZONE_NAMES: Record<PowerZone, string> = {
  1: "Recovery",
  2: "Endurance",
  3: "Tempo",
  4: "Threshold",
  5: "VO2 max",
  6: "Anaerobic",
};

/**
 * Coggan power zones as % of FTP: Z2 from 56%, then Z3 above 75%, Z4 above 90%,
 * Z5 above 105%, Z6 above 120%. Each zone starts 1 W after the last ends.
 */
export function powerZonesFromFtp(ftp: number): PowerZoneTable {
  const top = (pct: number) => Math.round(ftp * pct);
  const z1 = top(0.56) - 1;
  const z2 = top(0.75);
  const z3 = top(0.9);
  const z4 = top(1.05);
  const z5 = top(1.2);
  return { 1: [0, z1], 2: [z1 + 1, z2], 3: [z2 + 1, z3], 4: [z3 + 1, z4], 5: [z4 + 1, z5], 6: [z5 + 1, 2500] };
}

export function powerBounds(zone: PowerZone, zones: PowerZoneTable): Bounds {
  return {
    low: zone === 1 ? null : zones[zone][0],
    high: zone === 6 ? null : zones[zone][1],
    label: `Z${zone}`,
  };
}

export function powerZoneOf(watts: number, zones: PowerZoneTable): PowerZone {
  return POWER_ZONES.find((z) => watts <= zones[z][1]) ?? 6;
}

// --- Decoders -----------------------------------------------------------------

export interface TrainerReading {
  power: number | null; // W
  cadence: number | null; // rpm
  speed: number | null; // km/h
}

/** Cumulative crank revolutions + last crank event time (1/1024 s), from Cycling Power. */
export interface CrankData {
  revs: number;
  time: number;
}

/**
 * Fitness Machine "Indoor Bike Data" (characteristic 0x2AD2).
 * Flags (uint16): bit 0 = "more data" (speed ABSENT when set), 1 avg speed,
 * 2 cadence, 3 avg cadence, 4 distance, 5 resistance, 6 power, 7 avg power.
 */
export function parseIndoorBikeData(view: DataView): TrainerReading | null {
  if (view.byteLength < 2) return null;
  const flags = view.getUint16(0, true);
  let i = 2;
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  const need = (n: number) => i + n <= view.byteLength;
  const out: TrainerReading = { power: null, cadence: null, speed: null };

  if (!has(0)) {
    if (!need(2)) return null;
    out.speed = view.getUint16(i, true) / 100;
    i += 2;
  }
  if (has(1)) i += 2; // average speed
  if (has(2)) {
    if (!need(2)) return null;
    out.cadence = view.getUint16(i, true) / 2;
    i += 2;
  }
  if (has(3)) i += 2; // average cadence
  if (has(4)) i += 3; // total distance (uint24)
  if (has(5)) i += 2; // resistance level
  if (has(6)) {
    if (!need(2)) return null;
    out.power = view.getInt16(i, true);
    i += 2;
  }
  return out;
}

/**
 * Cycling Power Measurement (characteristic 0x2A63).
 * Flags (uint16), then instantaneous power (sint16). Optional fields follow in
 * order: bit 0 pedal balance (1), bit 2 accumulated torque (2), bit 4 wheel
 * revolutions (4 + 2), bit 5 crank revolutions (2 + 2).
 */
export function parseCyclingPower(view: DataView): { power: number; crank: CrankData | null } | null {
  if (view.byteLength < 4) return null;
  const flags = view.getUint16(0, true);
  const power = view.getInt16(2, true);
  let i = 4;
  if (flags & 0x01) i += 1;
  if (flags & 0x04) i += 2;
  if (flags & 0x10) i += 6;
  let crank: CrankData | null = null;
  if (flags & 0x20 && i + 4 <= view.byteLength) {
    crank = { revs: view.getUint16(i, true), time: view.getUint16(i + 2, true) };
  }
  return { power, crank };
}

/**
 * rpm between two crank readings. Both counters wrap at 65536. Returns null when
 * no new pedal stroke has happened (same event time), so the caller keeps the last value.
 */
export function cadenceFromCrank(prev: CrankData, cur: CrankData): number | null {
  const revs = (cur.revs - prev.revs + 0x10000) % 0x10000;
  const ticks = (cur.time - prev.time + 0x10000) % 0x10000;
  if (ticks === 0) return null;
  const rpm = (revs / (ticks / 1024)) * 60;
  return rpm > 250 ? null : Math.round(rpm);
}

/** Tacx's own Bluetooth service, which carries ANT+ FE-C messages. */
export const TACX_FEC_SERVICE = "6e40fec1-b5a3-f393-e0a9-e50e24dcca9e";
export const TACX_FEC_RX = "6e40fec2-b5a3-f393-e0a9-e50e24dcca9e";

/**
 * Tacx FE-C over Bluetooth: an ANT message [0xA4, length, id, channel, 8-byte page, checksum].
 * Page 0x19 (trainer data): cadence byte 2, power 12 bits in bytes 5-6.
 * Page 0x10 (general data): speed in bytes 4-5, 0.001 m/s.
 * Returns only the fields that page carries (others stay null).
 */
export function parseTacxFec(view: DataView): TrainerReading | null {
  if (view.byteLength < 12 || view.getUint8(0) !== 0xa4) return null;
  const p = (n: number) => view.getUint8(4 + n);
  const out: TrainerReading = { power: null, cadence: null, speed: null };
  const page = p(0);
  if (page === 0x19) {
    const cadence = p(2);
    const power = p(5) | ((p(6) & 0x0f) << 8);
    out.cadence = cadence === 0xff ? null : cadence;
    out.power = power === 0xfff ? null : power;
    return out;
  }
  if (page === 0x10) {
    const raw = p(4) | (p(5) << 8);
    out.speed = raw === 0xffff ? null : Math.round(raw * 0.0036 * 10) / 10;
    return out;
  }
  return null;
}

// --- Averages and summary ------------------------------------------------------

export interface PowerSample {
  t: number; // ms
  power: number;
  cadence: number | null;
}

/** Mean power over the last `windowMs` (3 s is the usual display average). */
export function rollingPower(samples: PowerSample[], now: number, windowMs = 3000): number | null {
  let sum = 0;
  let n = 0;
  for (let i = samples.length - 1; i >= 0 && samples[i].t > now - windowMs; i--) {
    sum += samples[i].power;
    n++;
  }
  return n === 0 ? null : Math.round(sum / n);
}

export interface PowerSummary {
  avgPower: number;
  /** Average while pedalling (zeros left out, as head units do). */
  avgCadence: number | null;
  /** Share of time in each power zone, 0-100. */
  zonePct: Record<PowerZone, number>;
}

/** Time-weighted like the heart rate summary; gaps between readings count at most 5 s. */
export function summarizePower(samples: PowerSample[], endedAt: number, zones: PowerZoneTable): PowerSummary | null {
  if (samples.length === 0) return null;
  let weight = 0;
  let powerSum = 0;
  let cadWeight = 0;
  let cadSum = 0;
  const inZone: Record<PowerZone, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  samples.forEach((s, i) => {
    const next = samples[i + 1]?.t ?? endedAt;
    const dt = Math.min(5000, Math.max(0, next - s.t)) || 1;
    weight += dt;
    powerSum += s.power * dt;
    if (s.cadence) {
      cadWeight += dt;
      cadSum += s.cadence * dt;
    }
    inZone[powerZoneOf(s.power, zones)] += dt;
  });
  const zonePct = Object.fromEntries(POWER_ZONES.map((z) => [z, Math.round((inZone[z] / weight) * 100)])) as Record<
    PowerZone,
    number
  >;
  return {
    avgPower: Math.round(powerSum / weight),
    avgCadence: cadWeight ? Math.round(cadSum / cadWeight) : null,
    zonePct,
  };
}
