import { describe, expect, it } from "vitest";
import {
  defaultSession,
  progressBlock,
  rideMinutes,
  toBlockDrafts,
  validateBlock,
  type BlockDraft,
  type SessionDraft,
  type WeekDraft,
} from "./blocks";
import type { PlannedSession, PlanWeek } from "./types";

const ride = (weekday: SessionDraft["weekday"], target: number, extra: Partial<SessionDraft> = {}): SessionDraft => ({
  ...defaultSession(weekday, "ride"),
  target_minutes: target,
  ...extra,
});

const week = (plan_week: number, type: WeekDraft["type"], sessions: SessionDraft[]): WeekDraft => ({
  plan_week, type, notes: null, sessions, used: false,
});

const block1: BlockDraft = {
  block: 1,
  weeks: [
    week(1, "habits", [ride(1, 45), ride(3, 30), ride(6, 60)]),
    week(2, "build", [ride(1, 45), ride(3, 30), ride(6, 60), ride(7, 45), defaultSession(1, "core")]),
    week(3, "easy", [ride(1, 45), ride(3, 30), ride(6, 60)]),
  ],
};

const opts = { cutoff: "19:00", preceding: [], expectedFirstWeek: 1, fixedWeekCount: null };

describe("defaultSession", () => {
  it("uses Block 1's slots for the day", () => {
    expect(defaultSession(4, "ride")).toMatchObject({ max_minutes: 60, backup_max_minutes: 30, primary_slot: "18:00" });
    expect(defaultSession(7, "ride")).toMatchObject({ max_minutes: null, backup_max_minutes: 120, target_minutes: 45 });
    expect(defaultSession(3, "core")).toMatchObject({ target_minutes: 15, primary_slot: "12:30", backup_slot: "20:00" });
  });
});

describe("toBlockDrafts", () => {
  it("groups weeks into blocks, skips the minimum template and marks used weeks", () => {
    const s = (id: string, weekday: PlannedSession["weekday"]): PlannedSession => ({
      id, weekday, kind: "ride", target_minutes: 30, max_minutes: 30, backup_max_minutes: 30, zone: "Z2",
      is_key: false, primary_slot: "07:00:00", backup_slot: "12:30:00", description: null,
    });
    const pw = (id: string, plan_week: number, block: number, type: PlanWeek["type"]) => ({
      id, plan_week, block, type, target_minutes: 0, notes: null, planned_sessions: [s(`${id}-s`, 3)],
    });
    const drafts = toBlockDrafts([pw("b", 2, 1, "build"), pw("t", 0, 0, "minimum"), pw("a", 1, 1, "habits")], new Set(["a"]));
    expect(drafts).toHaveLength(1);
    expect(drafts[0].weeks.map((w) => [w.plan_week, w.used])).toEqual([[1, true], [2, false]]);
    expect(drafts[0].weeks[0].sessions[0]).toMatchObject({ primary_slot: "07:00", backup_slot: "12:30" });
  });
});

describe("progressBlock", () => {
  const next = progressBlock(block1, 4, 10);

  it("numbers the new block's weeks on from the last one", () => {
    expect(next.block).toBe(2);
    expect(next.weeks.map((w) => w.plan_week)).toEqual([4, 5, 6]);
    expect(next.weeks.every((w) => !w.used)).toBe(true);
  });

  it("raises build-week rides by the percentage, rounded to 5 and capped at the slot ceiling", () => {
    // Mon 45 -> 49.5 -> 50 but ceiling 45; Wed 30 -> 33 -> 35 but ceiling 30; Sat 60 -> 66 -> 65; Sun 45 -> 50 (no ceiling)
    expect(next.weeks[1].sessions.map((s) => s.target_minutes)).toEqual([45, 30, 65, 50, 15]);
  });

  it("leaves habits and easy weeks and core sessions alone", () => {
    expect(rideMinutes(next.weeks[0])).toBe(rideMinutes(block1.weeks[0]));
    expect(rideMinutes(next.weeks[2])).toBe(rideMinutes(block1.weeks[2]));
    expect(next.weeks[1].sessions.find((s) => s.kind === "core")?.target_minutes).toBe(15);
  });

  it("doesn't change the source block", () => {
    expect(block1.weeks[1].sessions[2].target_minutes).toBe(60);
  });
});

describe("validateBlock errors", () => {
  it("accepts Block 1 as seeded", () => {
    expect(validateBlock(block1, opts).errors).toEqual([]);
  });

  it("rejects a target over the slot ceiling", () => {
    const bad = { ...block1, weeks: [week(1, "habits", [ride(3, 40)])] };
    expect(validateBlock(bad, opts).errors[0].message).toBe("Wed ride: 40 min is over the 30 min ceiling.");
  });

  it("rejects two rides on one day", () => {
    const bad = { ...block1, weeks: [week(1, "habits", [ride(1, 30), ride(1, 20)])] };
    expect(validateBlock(bad, opts).errors.map((e) => e.message)).toContain("Mon ride: only one ride per day.");
  });

  it("rejects bad minutes and times", () => {
    const bad = { ...block1, weeks: [week(1, "habits", [ride(1, 0), ride(2, 30, { primary_slot: "7am" })])] };
    expect(validateBlock(bad, opts).errors).toHaveLength(2);
  });

  it("keeps plan week numbers contiguous", () => {
    const gap = { ...block1, weeks: [block1.weeks[0], { ...block1.weeks[1], plan_week: 5 }] };
    expect(validateBlock(gap, opts).errors.map((e) => e.message)).toContain("Plan week numbers must run on without gaps.");
  });

  it("stops an earlier block from changing its length", () => {
    const shorter = { ...block1, weeks: block1.weeks.slice(0, 2) };
    expect(validateBlock(shorter, { ...opts, fixedWeekCount: 3 }).errors[0].message).toMatch(/must keep 3 weeks/);
  });
});

describe("validateBlock warnings", () => {
  it("warns when a key session can't finish before the cutoff", () => {
    const onTime = { ...block1, weeks: [week(1, "build", [ride(4, 60, { is_key: true })])] }; // Thu 18:00 + 60 = 19:00
    expect(validateBlock(onTime, opts).warnings).toEqual([]);
    const late = { ...block1, weeks: [week(1, "build", [ride(4, 45, { is_key: true, primary_slot: "18:30" })])] };
    expect(validateBlock(late, opts).warnings[0].message).toBe("Thu ride is key but would finish after 19:00 in its primary slot.");
  });

  it("warns when the backup slot of a key session ends after the cutoff", () => {
    const late = { ...block1, weeks: [week(1, "build", [ride(6, 45, { is_key: true, primary_slot: "09:00" })])] }; // backup 19:00
    expect(validateBlock(late, opts).warnings[0].message).toMatch(/backup slot ends at 19:45/);
  });

  it("warns on a build week over 20% above the last build week, including the previous block", () => {
    const next: BlockDraft = { block: 2, weeks: [week(4, "build", [ride(1, 45), ride(3, 30), ride(6, 90), ride(7, 75)])] };
    const r = validateBlock(next, { ...opts, expectedFirstWeek: 4, preceding: block1.weeks });
    // last build week before week 4 is week 2 (180 min); week 4 has 240
    expect(r.errors).toEqual([]);
    expect(r.warnings[0].message).toBe(
      "Ride time jumps 33% on the last build week (180 → 240 min). Over 20% is a big step.",
    );
  });

  it("doesn't flag Block 1 as designed (habits to build is a planned step up)", () => {
    expect(validateBlock(block1, opts).warnings).toEqual([]);
  });

  it("doesn't flag easy weeks or modest increases", () => {
    const progressed = progressBlock(block1, 4, 10);
    expect(validateBlock(progressed, { ...opts, expectedFirstWeek: 4, preceding: block1.weeks }).warnings).toEqual([]);
  });

  it("warns about a week with no rides", () => {
    const empty = { ...block1, weeks: [week(1, "easy", [])] };
    expect(validateBlock(empty, opts).warnings[0].message).toBe("No rides this week.");
  });
});

describe("parseBlockDraft", () => {
  it("round-trips a valid block and never trusts 'used' from the client", async () => {
    const { parseBlockDraft } = await import("./blocks");
    const raw = JSON.parse(JSON.stringify({ ...block1, weeks: block1.weeks.map((w) => ({ ...w, used: true })) }));
    const r = parseBlockDraft(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.weeks.every((w) => !w.used)).toBe(true);
  });

  it("rejects wrong types", async () => {
    const { parseBlockDraft } = await import("./blocks");
    const bad = JSON.parse(JSON.stringify(block1));
    bad.weeks[0].sessions[0].target_minutes = "45";
    expect(parseBlockDraft(bad).ok).toBe(false);
    expect(parseBlockDraft({ block: 1 }).ok).toBe(false);
    expect(parseBlockDraft(null).ok).toBe(false);
  });

  it("turns blank strings into nulls", async () => {
    const { parseBlockDraft } = await import("./blocks");
    const raw = JSON.parse(JSON.stringify(block1));
    raw.weeks[0].notes = "  ";
    raw.weeks[0].sessions[0].zone = "";
    const r = parseBlockDraft(raw);
    expect(r.ok && r.value.weeks[0].notes).toBeNull();
    expect(r.ok && r.value.weeks[0].sessions[0].zone).toBeNull();
  });
});
