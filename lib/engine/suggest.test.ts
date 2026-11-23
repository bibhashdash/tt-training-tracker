import { describe, expect, it } from "vitest";
import { addDays } from "../dates";
import { suggestNextWeek } from "./suggest";
import type { DailyLogIn, EngineSettings, PlannedSessionIn, SessionLogIn, WeekInput } from "./types";

const MON = "2026-11-23";
const day = (weekday: number) => addDays(MON, weekday - 1);

const settings: EngineSettings = {
  sleepThresholdHours: 6.5,
  sleepFlagNights: 3,
  dietFlagDays: 2,
  completionAdvancePct: 75,
  completionMinimumPct: 60,
};

const ride = (id: string, weekday: number, extra: Partial<PlannedSessionIn> = {}): PlannedSessionIn => ({
  id,
  date: day(weekday),
  kind: "ride",
  isKey: false,
  plannedOff: false,
  ...extra,
});

/** Plan week 1: Mon, Wed, Sat. */
const week1 = [ride("mon", 1), ride("wed", 3), ride("sat", 6)];
/** Plan week 2: Mon, Wed, Sat, Sun, plus core Mon/Wed. */
const week2 = [
  ride("mon", 1),
  ride("wed", 3),
  ride("sat", 6),
  ride("sun", 7),
  { ...ride("core-mon", 1), kind: "core" as const },
  { ...ride("core-wed", 3), kind: "core" as const },
];

const done = (s: PlannedSessionIn): SessionLogIn => ({ plannedSessionId: s.id, date: s.date, status: "done" });
const dropped = (s: PlannedSessionIn): SessionLogIn => ({ plannedSessionId: s.id, date: s.date, status: "dropped" });

const dl = (date: string, extra: Partial<DailyLogIn> = {}): DailyLogIn => ({
  date,
  sleepHours: 7.5,
  dietOk: true,
  unplannedTreat: false,
  plannedIndulgence: false,
  illness: "none",
  injuryNote: null,
  ...extra,
});

function run(overrides: Partial<WeekInput>) {
  return suggestNextWeek({ weekStart: MON, planned: week1, sessionLogs: [], dailyLogs: [], settings, ...overrides });
}

const codes = (r: ReturnType<typeof run>) => r.reasons.map((x) => x.code);

describe("completion", () => {
  it("advances when every ride is done and nothing is flagged", () => {
    const r = run({ sessionLogs: week1.map(done) });
    expect(r.suggestion).toBe("advance");
    expect(r.stats).toMatchObject({ sessionsPlanned: 3, sessionsDone: 3, completionPct: 100 });
    expect(r.flags.count).toBe(0);
  });

  it("advances at exactly 75%: one drop allowed in a 4-ride week", () => {
    const logs = [done(week2[0]), done(week2[1]), done(week2[2]), dropped(week2[3])];
    const r = run({ planned: week2, sessionLogs: logs });
    expect(r.stats.completionPct).toBe(75);
    expect(r.suggestion).toBe("advance");
  });

  it("repeats at 67% (2 of 3)", () => {
    const r = run({ sessionLogs: [done(week1[0]), done(week1[1]), dropped(week1[2])] });
    expect(r.stats.completionPct).toBe(67);
    expect(r.suggestion).toBe("repeat");
    expect(r.flags.sessions).toBe(true);
    expect(r.reasons[0].text).toBe("2 of 3 rides done (67%). 75% needed to move on.");
  });

  it("goes to a minimum week under 60% (1 of 3)", () => {
    const r = run({ sessionLogs: [done(week1[0])] });
    expect(r.stats.completionPct).toBe(33);
    expect(r.suggestion).toBe("minimum");
    expect(codes(r)).toContain("completion_low");
  });

  it("counts unlogged past sessions as not done", () => {
    const r = run({ sessionLogs: [done(week1[0]), done(week1[1])] });
    expect(r.stats).toMatchObject({ sessionsPlanned: 3, sessionsDone: 2 });
  });

  it("tracks core separately and never counts it", () => {
    const logs = [...week2.slice(0, 4).map(done)];
    const r = run({ planned: week2, sessionLogs: logs });
    expect(r.stats).toMatchObject({ sessionsPlanned: 4, sessionsDone: 4, corePlanned: 2, coreDone: 0 });
    expect(r.suggestion).toBe("advance");
  });

  it("ignores unplanned rides", () => {
    const unplanned: SessionLogIn = { plannedSessionId: null, date: day(2), status: "done" };
    const r = run({ sessionLogs: [done(week1[0]), unplanned] });
    expect(r.stats).toMatchObject({ sessionsPlanned: 3, sessionsDone: 1 });
    expect(r.suggestion).toBe("minimum");
  });

  it("repeats when there are no rides to count (e.g. coming back from a rest week)", () => {
    const r = run({ planned: [] });
    expect(r.suggestion).toBe("repeat");
    expect(codes(r)).toContain("nothing_to_count");
  });
});

describe("flags", () => {
  it("goes to minimum with full completion when sleep and diet are both flagged", () => {
    const daily = [
      dl(day(1), { sleepHours: 5 }),
      dl(day(2), { sleepHours: 6 }),
      dl(day(3), { sleepHours: 6, dietOk: false }),
      dl(day(4), { unplannedTreat: true }),
    ];
    const r = run({ sessionLogs: week1.map(done), dailyLogs: daily });
    expect(r.flags).toEqual({ sessions: false, sleep: true, diet: true, count: 2 });
    expect(r.suggestion).toBe("minimum");
    expect(codes(r)).toEqual(expect.arrayContaining(["flags", "flag_sleep", "flag_diet"]));
  });

  it("still advances with a single flag and good completion", () => {
    const daily = [dl(day(2), { dietOk: false }), dl(day(4), { unplannedTreat: true })];
    const r = run({ planned: week2, sessionLogs: week2.slice(0, 4).map(done), dailyLogs: daily });
    expect(r.flags.count).toBe(1);
    expect(r.suggestion).toBe("advance");
    expect(codes(r)).toContain("flag_diet");
  });

  it("doesn't create flags from missing daily logs", () => {
    const r = run({ sessionLogs: week1.map(done), dailyLogs: [] });
    expect(r.stats).toMatchObject({ shortSleepNights: 0, offPlanDays: 0 });
  });

  it("ignores missing sleep within a logged day", () => {
    const r = run({ sessionLogs: week1.map(done), dailyLogs: [dl(day(1), { sleepHours: null })] });
    expect(r.stats.shortSleepNights).toBe(0);
  });
});

describe("exclusions", () => {
  it("removes a planned-off session (Christmas Day) from the count", () => {
    const xmasWeek = [ride("mon", 1), ride("fri", 5, { plannedOff: true }), ride("sat", 6)];
    const r = run({ planned: xmasWeek, sessionLogs: [done(xmasWeek[0]), done(xmasWeek[2])] });
    expect(r.stats).toMatchObject({ sessionsPlanned: 2, sessionsDone: 2, completionPct: 100 });
    expect(r.suggestion).toBe("advance");
    expect(codes(r)).toContain("excluded_planned_off");
  });

  it("also honours a planned_off log", () => {
    const r = run({
      sessionLogs: [done(week1[0]), done(week1[1]), { plannedSessionId: "sat", date: day(6), status: "planned_off" }],
    });
    expect(r.stats).toMatchObject({ sessionsPlanned: 2, completionPct: 100 });
  });

  it("doesn't count Friday's indulgence against diet, or Saturday morning's short sleep", () => {
    const daily = [
      dl(day(5), { plannedIndulgence: true, dietOk: false, unplannedTreat: true }),
      dl(day(6), { sleepHours: 5 }),
      dl(day(2), { sleepHours: 6 }),
      dl(day(3), { sleepHours: 6 }),
    ];
    const r = run({ sessionLogs: week1.map(done), dailyLogs: daily });
    expect(r.stats.offPlanDays).toBe(0);
    expect(r.stats.shortSleepNights).toBe(2);
    expect(r.flags.sleep).toBe(false);
    expect(codes(r)).toContain("excluded_indulgence_sleep");
  });

  it("excludes sessions on illness days, so completion is worked out on the rest", () => {
    const daily = [dl(day(1), { illness: "above_neck" }), dl(day(2), { illness: "above_neck" })];
    const r = run({ sessionLogs: [done(week1[1]), done(week1[2])], dailyLogs: daily });
    expect(r.stats).toMatchObject({ sessionsPlanned: 2, sessionsDone: 2, completionPct: 100, illnessDays: 2 });
    expect(r.suggestion).toBe("advance");
    expect(codes(r)).toContain("excluded_illness");
  });

  it("still counts a session that was done on an illness day", () => {
    const daily = [dl(day(1), { illness: "above_neck" })];
    const r = run({ sessionLogs: week1.map(done), dailyLogs: daily });
    expect(r.stats).toMatchObject({ sessionsPlanned: 3, sessionsDone: 3 });
  });

  it("doesn't count sleep or diet on illness days", () => {
    const daily = [
      dl(day(1), { illness: "below_neck", sleepHours: 4, dietOk: false }),
      dl(day(2), { illness: "below_neck", sleepHours: 4, unplannedTreat: true }),
    ];
    const r = run({ sessionLogs: week1.map(done), dailyLogs: daily });
    expect(r.stats).toMatchObject({ shortSleepNights: 0, offPlanDays: 0 });
  });
});

describe("illness and injury", () => {
  it("suggests an easy return after 3 days ill", () => {
    const daily = [3, 4, 5].map((wd) => dl(day(wd), { illness: "below_neck" }));
    const r = run({ sessionLogs: [done(week1[0])], dailyLogs: daily });
    expect(r.stats.illnessDays).toBe(3);
    expect(r.suggestion).toBe("repeat_after_illness");
  });

  it("steps back after 7 days ill, counting a run that started last week", () => {
    const daily = [-3, -2, -1, 0, 1, 2, 3].map((i) => dl(addDays(MON, i), { illness: "below_neck" }));
    const r = run({ sessionLogs: [done(week1[2])], dailyLogs: daily });
    expect(r.stats.illnessDays).toBe(7);
    expect(r.suggestion).toBe("step_back");
  });

  it("ignores an illness run that ended before this week", () => {
    const daily = [-5, -4, -3, -2].map((i) => dl(addDays(MON, i), { illness: "below_neck" }));
    const r = run({ sessionLogs: week1.map(done), dailyLogs: daily });
    expect(r.stats.illnessDays).toBe(0);
    expect(r.suggestion).toBe("advance");
  });

  it("puts injury above everything, including 7+ days ill", () => {
    const daily = [-1, 0, 1, 2, 3, 4, 5, 6].map((i) =>
      dl(addDays(MON, i), { illness: "below_neck", injuryNote: i === 2 ? "Sore knee" : null }),
    );
    const r = run({ dailyLogs: daily });
    expect(r.suggestion).toBe("rest_injury");
    expect(r.reasons[0]).toEqual({
      code: "injury",
      text: "Injury noted on Wed 25 Nov. Rest and see a GP before riding again.",
    });
  });

  it("treats a blank injury note as no injury", () => {
    const r = run({ sessionLogs: week1.map(done), dailyLogs: [dl(day(2), { injuryNote: "   " })] });
    expect(r.suggestion).toBe("advance");
  });
});
