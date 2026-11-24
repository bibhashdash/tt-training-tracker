import { describe, expect, it } from "vitest";
import { isReviewOpen, nextWeekStartAfter, toWeekInput } from "./review-input";
import type { DailyLog, PlannedSession, Settings, WeekPlan } from "./types";

const settings: Settings = {
  sleep_threshold_hours: 6.5,
  sleep_flag_nights: 3,
  diet_flag_days: 2,
  completion_advance_pct: 75,
  completion_minimum_pct: 60,
  cutoff_time: "19:00:00",
  timezone: "Europe/London",
  block_start_date: "2026-11-23",
  review_opens_time: "18:00:00",
  planned_off_dates: ["2026-12-25"],
  ftp: 160,
  threshold_hr: 172,
};

const session = (id: string, weekday: PlannedSession["weekday"]): PlannedSession => ({
  id, weekday, kind: "ride", target_minutes: 30, max_minutes: 30, backup_max_minutes: 30,
  zone: "Z1-2", is_key: false, primary_slot: "07:00:00", backup_slot: "12:30:00", description: null,
});

describe("isReviewOpen", () => {
  it("opens at 18:00 on the week's Sunday", () => {
    expect(isReviewOpen("2026-11-23", "2026-11-29", "17:59", "18:00")).toBe(false);
    expect(isReviewOpen("2026-11-23", "2026-11-29", "18:00", "18:00")).toBe(true);
  });

  it("is closed earlier in the week and open once the week is over", () => {
    expect(isReviewOpen("2026-11-23", "2026-11-28", "23:00", "18:00")).toBe(false);
    expect(isReviewOpen("2026-11-23", "2026-11-30", "06:00", "18:00")).toBe(true);
  });

  it("is closed for future weeks", () => {
    expect(isReviewOpen("2026-11-30", "2026-11-29", "20:00", "18:00")).toBe(false);
  });
});

describe("nextWeekStartAfter", () => {
  it("is the following Monday for an on-time review", () => {
    expect(nextWeekStartAfter("2026-11-23", "2026-11-29")).toBe("2026-11-30");
    expect(nextWeekStartAfter("2026-11-23", "2026-11-30")).toBe("2026-11-30");
  });

  it("skips to this week when the review is late", () => {
    expect(nextWeekStartAfter("2026-11-23", "2026-12-09")).toBe("2026-12-07");
  });
});

describe("toWeekInput", () => {
  it("resolves session dates and marks Christmas as planned off", () => {
    const plan: WeekPlan = {
      id: "wp", week_start: "2026-12-21", pointer: 5, variant: "normal", pending_after: null,
      plan_week: {
        id: "pw", plan_week: 5, block: 1, type: "build", target_minutes: 240, notes: null,
        planned_sessions: [session("mon", 1), session("fri", 5)],
      },
    };
    const daily = [{ date: "2026-12-21", sleep_hours: "7.5" as unknown as number } as DailyLog];
    const input = toWeekInput(plan, [], daily, settings);
    expect(input.planned).toEqual([
      { id: "mon", date: "2026-12-21", kind: "ride", isKey: false, plannedOff: false },
      { id: "fri", date: "2026-12-25", kind: "ride", isKey: false, plannedOff: true },
    ]);
    expect(input.dailyLogs[0].sleepHours).toBe(7.5); // Postgres numeric may arrive as a string
  });

  it("has no sessions in a rest week", () => {
    const rest: WeekPlan = { id: "wp", week_start: "2026-12-21", pointer: 4, variant: "rest", pending_after: null, plan_week: null };
    expect(toWeekInput(rest, [], [], settings).planned).toEqual([]);
  });
});
