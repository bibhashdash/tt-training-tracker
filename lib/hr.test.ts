import { describe, expect, it } from "vitest";
import {
  classify,
  DEFAULT_THRESHOLD,
  isValidThreshold,
  simTargets,
  zonesFromThreshold,
  gaugePosition,
  gaugeRange,
  parseHeartRate,
  smoothed,
  stepNudge,
  summarize,
  ZONE_BPM,
  zoneBounds,
  type Sample,
} from "./hr";
import { hrZone } from "./session-rules";

const view = (...bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe("parseHeartRate", () => {
  it("reads an 8-bit value", () => {
    expect(parseHeartRate(view(0x00, 72))).toEqual({ bpm: 72, contact: null });
  });

  it("reads a 16-bit little-endian value", () => {
    expect(parseHeartRate(view(0x01, 0x2c, 0x01))).toEqual({ bpm: 300, contact: null });
  });

  it("reports skin contact when the strap supports it", () => {
    expect(parseHeartRate(view(0x06, 140))).toEqual({ bpm: 140, contact: true });
    expect(parseHeartRate(view(0x04, 0))).toEqual({ bpm: 0, contact: false });
  });

  it("ignores RR intervals and energy fields that follow", () => {
    expect(parseHeartRate(view(0x16, 150, 0x10, 0x02))?.bpm).toBe(150);
  });

  it("rejects truncated packets", () => {
    expect(parseHeartRate(view(0x00))).toBeNull();
    expect(parseHeartRate(view(0x01, 0x2c))).toBeNull();
  });
});

describe("zones", () => {
  it("agrees with hrZone at every boundary", () => {
    for (const [zone, [lo, hi]] of Object.entries(ZONE_BPM)) {
      expect(hrZone(Math.max(lo, 40))).toBe(Number(zone));
      expect(hrZone(hi)).toBe(Number(zone));
    }
  });

  it("works out bounds from a session's zone", () => {
    expect(zoneBounds("Z1-2")).toEqual({ low: null, high: 154, label: "Z1-2" });
    expect(zoneBounds("Z2")).toEqual({ low: 139, high: 154, label: "Z2" });
    expect(zoneBounds("Z3")).toEqual({ low: 155, high: 161, label: "Z3" });
    expect(zoneBounds("Z5")).toEqual({ low: 172, high: null, label: "Z5" });
    expect(zoneBounds(null)).toBeNull();
    expect(zoneBounds("easy")).toBeNull();
  });

  it("classifies under, in and over", () => {
    const z2 = zoneBounds("Z2")!;
    expect(classify(130, z2)).toBe("under");
    expect(classify(139, z2)).toBe("in");
    expect(classify(154, z2)).toBe("in");
    expect(classify(155, z2)).toBe("over");
    expect(classify(90, zoneBounds("Z1-2")!)).toBe("in"); // easy rides have no floor
  });
});

describe("smoothed", () => {
  it("averages the last 5 seconds", () => {
    const s: Sample[] = [
      { t: 0, bpm: 100 },
      { t: 6000, bpm: 140 },
      { t: 8000, bpm: 150 },
      { t: 10000, bpm: 160 },
    ];
    expect(smoothed(s, 10000)).toBe(150);
    expect(smoothed(s, 30000)).toBeNull();
  });
});

describe("stepNudge", () => {
  it("nudges after 10 s out of zone, then every 30 s", () => {
    let r = stepNudge(null, "over", 0);
    expect(r.nudge).toBe(false);
    r = stepNudge(r.state, "over", 9_000);
    expect(r.nudge).toBe(false);
    r = stepNudge(r.state, "over", 10_000);
    expect(r.nudge).toBe(true);
    r = stepNudge(r.state, "over", 20_000);
    expect(r.nudge).toBe(false);
    r = stepNudge(r.state, "over", 40_000);
    expect(r.nudge).toBe(true);
  });

  it("resets when back in zone or switching side", () => {
    let r = stepNudge(null, "over", 0);
    r = stepNudge(r.state, "in", 8_000);
    r = stepNudge(r.state, "over", 9_000);
    r = stepNudge(r.state, "over", 15_000);
    expect(r.nudge).toBe(false); // only 6 s since going over again
    r = stepNudge(r.state, "under", 16_000);
    expect(r.state.since).toBe(16_000);
  });

  it("never nudges while in zone", () => {
    let r = stepNudge(null, "in", 0);
    r = stepNudge(r.state, "in", 60_000);
    expect(r.nudge).toBe(false);
  });
});

describe("gauge", () => {
  it("shows the band with room either side", () => {
    expect(gaugeRange(zoneBounds("Z3")!)).toEqual([140, 176]);
    expect(gaugeRange(zoneBounds("Z1-2")!)).toEqual([99, 169]);
  });

  it("clamps the needle to the gauge", () => {
    expect(gaugePosition(158, [140, 176])).toBeCloseTo(0.5);
    expect(gaugePosition(100, [140, 176])).toBe(0);
    expect(gaugePosition(200, [140, 176])).toBe(1);
  });
});

describe("summarize", () => {
  it("gives minutes, time-weighted average HR and time in zone", () => {
    const s: Sample[] = [
      { t: 0, bpm: 130 },
      { t: 1000, bpm: 140 },
      { t: 2000, bpm: 150 },
      { t: 3000, bpm: 160 },
    ];
    // 130,140,150 count 1 s each; 160 counts 5 s (capped) -> (420 + 800) / 8 = 152.5
    expect(summarize(s, 0, 45 * 60_000, zoneBounds("Z2"))).toEqual({ minutes: 45, avgHr: 153, inZonePct: 25 });
  });

  it("caps dropouts at 5 s so a gap doesn't skew the average", () => {
    const s: Sample[] = [
      { t: 0, bpm: 100 },
      { t: 600_000, bpm: 160 },
    ];
    // 100 counts 5 s, 160 counts min(5 s, until end)
    expect(summarize(s, 0, 605_000, null).avgHr).toBe(130);
  });

  it("handles a ride with no readings", () => {
    expect(summarize([], 0, 30_000, zoneBounds("Z2"))).toEqual({ minutes: 1, avgHr: null, inZonePct: null });
  });
});

describe("zonesFromThreshold", () => {
  it("reproduces the plan's zone table at a threshold of 172", () => {
    expect(zonesFromThreshold(DEFAULT_THRESHOLD)).toEqual({
      1: [0, 138],
      2: [139, 154],
      3: [155, 161],
      4: [162, 171],
      5: [172, 250],
    });
  });

  it("scales the zones with a different threshold", () => {
    // 160: Z2 from 130 (81%), Z3 from 144 (90%), Z4 from 150 (94%), Z5 from 160
    const z = zonesFromThreshold(160);
    expect(z).toEqual({ 1: [0, 129], 2: [130, 143], 3: [144, 149], 4: [150, 159], 5: [160, 250] });
    expect(zoneBounds("Z2", z)).toEqual({ low: 130, high: 143, label: "Z2" });
    expect(zoneBounds("Z1-2", z)).toEqual({ low: null, high: 143, label: "Z1-2" });
  });

  it("leaves no gaps or overlaps between zones", () => {
    for (const t of [120, 150, 165, 185, 200]) {
      const z = zonesFromThreshold(t);
      for (const n of [1, 2, 3, 4] as const) expect(z[(n + 1) as 2][0]).toBe(z[n][1] + 1);
    }
  });

  it("accepts sensible thresholds only", () => {
    expect(isValidThreshold(172)).toBe(true);
    expect(isValidThreshold(99)).toBe(false);
    expect(isValidThreshold(221)).toBe(false);
    expect(isValidThreshold(170.5)).toBe(false);
  });
});

describe("simTargets", () => {
  it("sits below, inside and above a band", () => {
    expect(simTargets(zoneBounds("Z2")!)).toEqual({ under: 127, in: 147, over: 162 });
  });

  it("has nothing below an easy zone, or above Z5", () => {
    expect(simTargets(zoneBounds("Z1-2")!).under).toBeNull();
    expect(simTargets(zoneBounds("Z5")!).over).toBeNull();
  });
});
