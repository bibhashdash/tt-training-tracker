import { describe, expect, it } from "vitest";
import { isIsoDate, parseDailyLog, parseSessionLog, parseSettings } from "./validation";

const ID = "3f1c9a52-7d7b-4e0a-9a51-0f6f6b1c2d3e";

describe("isIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isIsoDate("2026-11-23")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("23/11/2026")).toBe(false);
    expect(isIsoDate(20261123)).toBe(false);
  });
});

describe("parseSessionLog", () => {
  const done = {
    date: "2026-11-23", plannedSessionId: ID, status: "done", slotUsed: "primary",
    actualMinutes: 45, avgHr: 135, rpe: null, bike: "turbo_road", notes: "  felt good ",
  };

  it("accepts a done session and trims notes", () => {
    const r = parseSessionLog(done);
    expect(r).toEqual({
      ok: true,
      value: {
        date: "2026-11-23", planned_session_id: ID, status: "done", slot_used: "primary",
        actual_minutes: 45, avg_hr: 135, rpe: null, bike: "turbo_road", notes: "felt good",
      },
    });
  });

  it("takes average power and cadence when sent, and leaves them out when not", () => {
    const withPower = parseSessionLog({ ...done, avgPower: 145, avgCadence: 88 });
    expect(withPower.ok && withPower.value).toMatchObject({ avg_power: 145, avg_cadence: 88 });
    const without = parseSessionLog(done);
    expect(without.ok && "avg_power" in without.value).toBe(false); // an edit won't wipe recorded power
    expect(parseSessionLog({ ...done, avgPower: 3000 }).ok).toBe(false);
    expect(parseSessionLog({ ...done, avgCadence: -1 }).ok).toBe(false);
  });

  it("strips everything but the status from a dropped session", () => {
    const r = parseSessionLog({ ...done, status: "dropped" });
    expect(r.ok && r.value).toMatchObject({ status: "dropped", actual_minutes: null, bike: null, slot_used: null });
  });

  it("requires minutes for a done session", () => {
    expect(parseSessionLog({ ...done, actualMinutes: "" }).ok).toBe(false);
    expect(parseSessionLog({ ...done, actualMinutes: 0 }).ok).toBe(false);
    expect(parseSessionLog({ ...done, actualMinutes: 45.5 }).ok).toBe(false);
  });

  it("rejects out-of-range HR and RPE", () => {
    expect(parseSessionLog({ ...done, avgHr: 300 }).ok).toBe(false);
    expect(parseSessionLog({ ...done, rpe: 11 }).ok).toBe(false);
  });

  it("forces unplanned rides to the 'other' slot and refuses dropping them", () => {
    const r = parseSessionLog({ ...done, plannedSessionId: null, slotUsed: "primary" });
    expect(r.ok && r.value.slot_used).toBe("other");
    expect(parseSessionLog({ ...done, plannedSessionId: null, status: "dropped" }).ok).toBe(false);
  });

  it("rejects junk ids, statuses and dates", () => {
    expect(parseSessionLog({ ...done, plannedSessionId: "x; drop table" }).ok).toBe(false);
    expect(parseSessionLog({ ...done, status: "moved" }).ok).toBe(false);
    expect(parseSessionLog({ ...done, date: "tomorrow" }).ok).toBe(false);
    expect(parseSessionLog(null).ok).toBe(false);
  });
});

describe("parseDailyLog", () => {
  const base = {
    date: "2026-11-27", sleepHours: 7.5, dietOk: true, unplannedTreat: false,
    plannedIndulgence: true, illness: "none", injuryNote: "  ", energy: null,
  };

  it("accepts a valid log and blanks an empty injury note", () => {
    const r = parseDailyLog(base);
    expect(r.ok && r.value).toMatchObject({ sleep_hours: 7.5, planned_indulgence: true, injury_note: null });
  });

  it("ignores fields it doesn't know, such as the retired bedtime", () => {
    const r = parseDailyLog({ ...base, bedtime: "23:30" });
    expect(r.ok && "bedtime" in r.value).toBe(false);
  });

  it("allows sleep to be left out", () => {
    const r = parseDailyLog({ ...base, sleepHours: null });
    expect(r.ok && r.value.sleep_hours).toBeNull();
  });

  it("rejects bad values", () => {
    expect(parseDailyLog({ ...base, sleepHours: 25 }).ok).toBe(false);
    expect(parseDailyLog({ ...base, illness: "flu" }).ok).toBe(false);
    expect(parseDailyLog({ ...base, energy: 6 }).ok).toBe(false);
    expect(parseDailyLog({ ...base, unplannedTreat: "yes" }).ok).toBe(false);
  });
});

describe("parseSettings", () => {
  const form = {
    sleep_threshold_hours: "6.5", sleep_flag_nights: "3", diet_flag_days: "2",
    completion_advance_pct: "75", completion_minimum_pct: "60", cutoff_time: "19:00",
    planned_off_dates: "2026-12-25, 2026-12-25\n2027-01-01",
    ftp: "160",
    threshold_hr: "172",
  };

  it("parses the form and dedupes planned-off dates", () => {
    const r = parseSettings(form);
    expect(r.ok && r.value).toEqual({
      sleep_threshold_hours: 6.5, sleep_flag_nights: 3, diet_flag_days: 2,
      completion_advance_pct: 75, completion_minimum_pct: 60, cutoff_time: "19:00",
      planned_off_dates: ["2026-12-25", "2027-01-01"],
      ftp: 160,
      threshold_hr: 172,
    });
  });

  it("accepts a time input with seconds", () => {
    const r = parseSettings({ ...form, cutoff_time: "19:00:00" });
    expect(r.ok && r.value.cutoff_time).toBe("19:00");
  });

  it("rejects minimum above advance, bad dates and bad times", () => {
    expect(parseSettings({ ...form, completion_minimum_pct: "80" }).ok).toBe(false);
    expect(parseSettings({ ...form, planned_off_dates: "Christmas" }).ok).toBe(false);
    expect(parseSettings({ ...form, cutoff_time: "7pm" }).ok).toBe(false);
    expect(parseSettings({ ...form, sleep_flag_nights: "0" }).ok).toBe(false);
    expect(parseSettings({ ...form, ftp: "40" }).ok).toBe(false);
    expect(parseSettings({ ...form, threshold_hr: "250" }).ok).toBe(false);
  });
});
