import { describe, expect, it } from "vitest";
import { buildWeekDays } from "./week-days";
import type { PlannedSession, SessionLog, WeekPlan } from "./types";

const s = (id: string, weekday: PlannedSession["weekday"], kind: "ride" | "core" = "ride", target = 30): PlannedSession => ({
  id, weekday, kind, target_minutes: target, max_minutes: 60, backup_max_minutes: 60, zone: "Z2",
  is_key: false, primary_slot: "07:00:00", backup_slot: null, description: null,
});

const log = (id: string | null, date: string, status: SessionLog["status"], minutes: number | null = null): SessionLog => ({
  id: `log-${id}-${date}`, date, planned_session_id: id, status, slot_used: status === "done" ? "primary" : null,
  actual_minutes: minutes, avg_hr: null, rpe: null, bike: null, notes: null, avg_power: null, avg_cadence: null,
});

const plan: WeekPlan = {
  id: "wp", week_start: "2026-12-21", pointer: 5, variant: "normal", pending_after: null,
  plan_week: {
    id: "pw", plan_week: 5, block: 1, type: "build", target_minutes: 0, notes: null,
    planned_sessions: [s("mon", 1, "ride", 45), s("core", 1, "core", 15), s("wed", 3), s("fri", 5), s("sat", 6, "ride", 60)],
  },
};

describe("buildWeekDays", () => {
  const logs = [
    log("mon", "2026-12-21", "done", 50),
    log("core", "2026-12-21", "done", 15),
    log(null, "2026-12-22", "done", 20),
  ];
  // Wednesday 23 Dec: Monday done, Wednesday today, Friday is Christmas.
  const { days, totals } = buildWeekDays(plan, "2026-12-21", logs, [], ["2026-12-25"], "2026-12-23");

  it("lays out Mon-Sun with dates", () => {
    expect(days.map((d) => d.date)).toEqual([
      "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27",
    ]);
  });

  it("marks each session done, pending, planned off or missed", () => {
    expect(days[0].sessions.map((x) => x.state)).toEqual(["done", "done"]);
    expect(days[2].sessions[0].state).toBe("pending"); // today, not logged yet
    expect(days[4].sessions[0].state).toBe("planned_off");
    expect(days[5].sessions[0].state).toBe("pending");
  });

  it("calls an unlogged past session missed", () => {
    const r = buildWeekDays(plan, "2026-12-21", [], [], [], "2026-12-24");
    expect(r.days[2].sessions[0].state).toBe("missed");
  });

  it("puts unplanned rides on their day", () => {
    expect(days[1].unplanned).toHaveLength(1);
  });

  it("totals ride minutes: planned skips planned-off days, done includes unplanned but not core", () => {
    expect(totals).toEqual({ plannedMinutes: 45 + 30 + 60, doneMinutes: 50 + 20 });
  });

  it("handles a rest week", () => {
    const rest = { ...plan, variant: "rest" as const, plan_week: null };
    const r = buildWeekDays(rest, "2026-12-21", [], [], [], "2026-12-23");
    expect(r.days.every((d) => d.sessions.length === 0)).toBe(true);
    expect(r.totals).toEqual({ plannedMinutes: 0, doneMinutes: 0 });
  });
});
