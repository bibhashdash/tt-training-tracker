import { describe, expect, it } from "vitest";
import {
  canLogDate,
  capFor,
  defaultBike,
  hrZone,
  latestStart,
  tooLateForKey,
  zoneCeiling,
} from "./session-rules";

const thu = { max_minutes: 60, backup_max_minutes: 30 };
const mon = { max_minutes: 45, backup_max_minutes: 45 };
const sun = { max_minutes: null, backup_max_minutes: 120 };

describe("capFor", () => {
  it("uses the primary cap for primary and other slots", () => {
    expect(capFor(thu, "primary", "turbo_road")).toBe(60);
    expect(capFor(thu, "other", "turbo_road")).toBe(60);
  });

  it("uses the lower backup cap on Thursday", () => {
    expect(capFor(thu, "backup", "turbo_road")).toBe(30);
    expect(capFor(mon, "backup", "turbo_road")).toBe(45);
  });

  it("has no Sunday limit outdoors but caps the turbo at 2h", () => {
    expect(capFor(sun, "primary", "road_outdoor")).toBeNull();
    expect(capFor(sun, "primary", "tt_outdoor")).toBeNull();
    expect(capFor(sun, "primary", "turbo_road")).toBe(120);
    expect(capFor(sun, "backup", "road_outdoor")).toBe(120);
  });

  it("falls back to max_minutes when there is no backup cap", () => {
    expect(capFor({ max_minutes: 30, backup_max_minutes: null }, "backup", "turbo_road")).toBe(30);
  });
});

describe("key session cutoff (19:00)", () => {
  const key = { is_key: true, target_minutes: 45 };

  it("allows a key session that finishes by the cutoff", () => {
    expect(tooLateForKey(key, "07:00", "19:00")).toBe(false);
    expect(tooLateForKey(key, "18:15", "19:00")).toBe(false);
  });

  it("blocks a key session that would finish after the cutoff", () => {
    expect(tooLateForKey(key, "18:16", "19:00")).toBe(true);
    expect(tooLateForKey(key, "20:00", "19:00")).toBe(true);
  });

  it("never applies to non-key sessions", () => {
    expect(tooLateForKey({ is_key: false, target_minutes: 45 }, "21:00", "19:00")).toBe(false);
  });

  it("works out the latest start", () => {
    expect(latestStart(45, "19:00")).toBe("18:15");
  });
});

describe("defaultBike", () => {
  it("is the turbo on weekdays and outdoors at weekends", () => {
    expect(defaultBike(1)).toBe("turbo_road");
    expect(defaultBike(5)).toBe("turbo_road");
    expect(defaultBike(6)).toBe("road_outdoor");
    expect(defaultBike(7)).toBe("road_outdoor");
  });
});

describe("canLogDate", () => {
  const today = "2026-12-02"; // Wed of calendar week 2

  it("allows today and earlier days back to last Monday", () => {
    expect(canLogDate("2026-12-02", today)).toBe(true);
    expect(canLogDate("2026-11-30", today)).toBe(true);
    expect(canLogDate("2026-11-23", today)).toBe(true);
  });

  it("refuses the future and anything before last week", () => {
    expect(canLogDate("2026-12-03", today)).toBe(false);
    expect(canLogDate("2026-11-22", today)).toBe(false);
  });
});

describe("HR zones", () => {
  it("maps heart rate to zones with the brief's gaps closed downwards", () => {
    expect(hrZone(120)).toBe(1);
    expect(hrZone(138)).toBe(1);
    expect(hrZone(139)).toBe(2);
    expect(hrZone(154)).toBe(2);
    expect(hrZone(155)).toBe(3);
    expect(hrZone(161)).toBe(3);
    expect(hrZone(162)).toBe(4);
    expect(hrZone(171)).toBe(4);
    expect(hrZone(172)).toBe(5);
  });

  it("reads the ceiling of a target zone", () => {
    expect(zoneCeiling("Z1-2")).toBe(2);
    expect(zoneCeiling("Z2")).toBe(2);
    expect(zoneCeiling("Z3")).toBe(3);
    expect(zoneCeiling(null)).toBeNull();
  });
});

describe("hrZone with a threshold from Settings", () => {
  it("keeps the plan's table at 172 and moves with the threshold", () => {
    expect(hrZone(150)).toBe(2);
    expect(hrZone(150, 172)).toBe(2);
    expect(hrZone(150, 160)).toBe(4); // 160: Z4 is 150-159
    expect(hrZone(129, 160)).toBe(1);
    expect(hrZone(165, 160)).toBe(5);
  });
});
