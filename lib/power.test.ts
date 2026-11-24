import { describe, expect, it } from "vitest";
import {
  cadenceFromCrank,
  isValidFtp,
  parseCyclingPower,
  parseIndoorBikeData,
  parseTacxFec,
  powerBounds,
  powerZoneOf,
  powerZonesFromFtp,
  rollingPower,
  summarizePower,
  type PowerSample,
} from "./power";

const view = (...bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);
const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];

describe("power zones", () => {
  it("matches the Coggan table at FTP 160", () => {
    expect(powerZonesFromFtp(160)).toEqual({
      1: [0, 89],
      2: [90, 120],
      3: [121, 144],
      4: [145, 168],
      5: [169, 192],
      6: [193, 2500],
    });
  });

  it("leaves no gaps between zones", () => {
    for (const ftp of [100, 160, 250, 333]) {
      const z = powerZonesFromFtp(ftp);
      for (const n of [1, 2, 3, 4, 5] as const) expect(z[(n + 1) as 2][0]).toBe(z[n][1] + 1);
    }
  });

  it("gives tuner bounds and finds a zone", () => {
    const z = powerZonesFromFtp(160);
    expect(powerBounds(2, z)).toEqual({ low: 90, high: 120, label: "Z2" });
    expect(powerBounds(1, z).low).toBeNull();
    expect(powerBounds(6, z).high).toBeNull();
    expect(powerZoneOf(0, z)).toBe(1);
    expect(powerZoneOf(120, z)).toBe(2);
    expect(powerZoneOf(121, z)).toBe(3);
    expect(powerZoneOf(400, z)).toBe(6);
  });

  it("accepts sensible FTPs only", () => {
    expect(isValidFtp(160)).toBe(true);
    expect(isValidFtp(49)).toBe(false);
    expect(isValidFtp(601)).toBe(false);
    expect(isValidFtp(160.5)).toBe(false);
  });
});

describe("parseIndoorBikeData (FTMS)", () => {
  it("reads speed, cadence and power", () => {
    // flags: cadence (bit 2) + power (bit 6); speed present because bit 0 is clear
    const flags = (1 << 2) | (1 << 6);
    const r = parseIndoorBikeData(view(...u16(flags), ...u16(2850), ...u16(180), ...u16(145)));
    expect(r).toEqual({ speed: 28.5, cadence: 90, power: 145 });
  });

  it("skips fields it doesn't use to find power", () => {
    // more data (no speed), avg speed, cadence, distance (3 bytes), resistance, power
    const flags = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 4) | (1 << 5) | (1 << 6);
    const r = parseIndoorBikeData(
      view(...u16(flags), ...u16(2000), ...u16(170), 0x10, 0x27, 0x00, ...u16(20), ...u16(210)),
    );
    expect(r).toEqual({ speed: null, cadence: 85, power: 210 });
  });

  it("rejects truncated data", () => {
    expect(parseIndoorBikeData(view(0x40, 0x00))).toBeNull();
  });
});

describe("parseCyclingPower (CPS)", () => {
  it("reads power and crank data after optional fields", () => {
    // flags: balance (bit 0) + crank (bit 5)
    const r = parseCyclingPower(view(...u16(0x21), ...u16(150), 50, ...u16(1000), ...u16(2048)));
    expect(r).toEqual({ power: 150, crank: { revs: 1000, time: 2048 } });
  });

  it("works without crank data", () => {
    expect(parseCyclingPower(view(...u16(0), ...u16(95)))).toEqual({ power: 95, crank: null });
  });
});

describe("cadenceFromCrank", () => {
  it("works out rpm from revolutions and event time", () => {
    // 3 revolutions in 2 s (2048 ticks of 1/1024 s) = 90 rpm
    expect(cadenceFromCrank({ revs: 100, time: 1000 }, { revs: 103, time: 3048 })).toBe(90);
  });

  it("handles counters wrapping at 65536", () => {
    expect(cadenceFromCrank({ revs: 65535, time: 65000 }, { revs: 2, time: 1512 })).toBe(90);
  });

  it("returns null when no new pedal stroke arrived", () => {
    expect(cadenceFromCrank({ revs: 5, time: 100 }, { revs: 5, time: 100 })).toBeNull();
  });
});

describe("parseTacxFec", () => {
  const ant = (...page: number[]) => view(0xa4, 0x09, 0x4e, 0x05, ...page, 0x00);

  it("reads cadence and 12-bit power from the trainer data page", () => {
    // power 0x1A5 = 421: LSB 0xA5, MSB nibble 0x1 (upper nibble is trainer status)
    expect(parseTacxFec(ant(0x19, 0x01, 92, 0x00, 0x00, 0xa5, 0x31, 0x00))).toEqual({
      cadence: 92,
      power: 421,
      speed: null,
    });
  });

  it("reads speed from the general page", () => {
    // 8333 mm/s = 30 km/h
    expect(parseTacxFec(ant(0x10, 0x19, 0x00, 0x00, ...u16(8333), 0x00, 0x00))?.speed).toBe(30);
  });

  it("treats 'invalid' markers as missing", () => {
    expect(parseTacxFec(ant(0x19, 0x01, 0xff, 0x00, 0x00, 0xff, 0x0f, 0x00))).toEqual({
      cadence: null,
      power: null,
      speed: null,
    });
  });

  it("ignores other pages and non-ANT data", () => {
    expect(parseTacxFec(ant(0x50, 0, 0, 0, 0, 0, 0, 0))).toBeNull();
    expect(parseTacxFec(view(0x00, 0x01))).toBeNull();
  });
});

describe("rollingPower and summarizePower", () => {
  const s: PowerSample[] = [
    { t: 0, power: 100, cadence: 85 },
    { t: 1000, power: 130, cadence: 90 },
    { t: 2000, power: 0, cadence: 0 },
    { t: 3000, power: 160, cadence: 95 },
  ];

  it("averages power over the last 3 seconds", () => {
    expect(rollingPower(s, 3000)).toBe(97); // 130, 0, 160
    expect(rollingPower(s, 10_000)).toBeNull();
  });

  it("summarises power, cadence while pedalling, and time in zones", () => {
    const r = summarizePower(s, 4000, powerZonesFromFtp(160));
    expect(r).toEqual({
      avgPower: 98, // (100 + 130 + 0 + 160) / 4
      avgCadence: 90, // zeros left out
      zonePct: { 1: 25, 2: 25, 3: 25, 4: 25, 5: 0, 6: 0 },
    });
  });

  it("returns null with no readings", () => {
    expect(summarizePower([], 0, powerZonesFromFtp(160))).toBeNull();
  });
});
