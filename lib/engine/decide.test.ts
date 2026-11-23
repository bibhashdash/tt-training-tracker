import { describe, expect, it } from "vitest";
import { applyDecision, describeNextWeek } from "./decide";
import type { PlanState } from "./types";

const at = (pointer: number, extra: Partial<PlanState> = {}): PlanState => ({
  pointer,
  variant: "normal",
  pendingAfter: null,
  maxPlanWeek: 6,
  ...extra,
});

describe("applyDecision from a normal week", () => {
  it("advance moves the pointer on", () => {
    expect(applyDecision(at(2), "advance")).toEqual({
      pointer: 3, planWeek: 3, variant: "normal", pendingAfter: null, blockComplete: false,
    });
  });

  it("repeat keeps the pointer", () => {
    expect(applyDecision(at(2), "repeat")).toMatchObject({ pointer: 2, planWeek: 2, variant: "normal" });
  });

  it("minimum schedules the template and holds the pointer", () => {
    expect(applyDecision(at(4), "minimum")).toMatchObject({ pointer: 4, planWeek: 0, variant: "minimum" });
  });

  it("repeat_after_illness schedules an easy week and remembers the week to redo", () => {
    expect(applyDecision(at(4), "repeat_after_illness")).toMatchObject({
      pointer: 4, planWeek: 0, variant: "easy_return", pendingAfter: 4,
    });
  });

  it("step_back goes back one, but never below week 1", () => {
    expect(applyDecision(at(4), "step_back")).toMatchObject({ pointer: 3, planWeek: 3 });
    expect(applyDecision(at(1), "step_back")).toMatchObject({ pointer: 1, planWeek: 1 });
  });

  it("rest_injury schedules no riding and holds the pointer", () => {
    expect(applyDecision(at(4), "rest_injury")).toMatchObject({ pointer: 4, planWeek: null, variant: "rest" });
  });

  it("an override to a specific week sets the pointer there, clamped to the block", () => {
    expect(applyDecision(at(2), { planWeek: 5 })).toMatchObject({ pointer: 5, planWeek: 5, variant: "normal" });
    expect(applyDecision(at(2), { planWeek: 9 })).toMatchObject({ pointer: 6, planWeek: 6 });
    expect(applyDecision(at(2), { planWeek: 0 })).toMatchObject({ pointer: 1, planWeek: 1 });
  });

  it("advance at the end of the block repeats the last week and says the block is done", () => {
    expect(applyDecision(at(6), "advance")).toMatchObject({ pointer: 6, planWeek: 6, blockComplete: true });
  });
});

describe("applyDecision after a week on hold", () => {
  it("a good easy-return week schedules the interrupted plan week", () => {
    const state = at(4, { variant: "easy_return", pendingAfter: 4 });
    expect(applyDecision(state, "advance")).toMatchObject({ pointer: 4, planWeek: 4, variant: "normal" });
    expect(applyDecision(state, "repeat")).toMatchObject({ pointer: 4, planWeek: 4, variant: "normal" });
  });

  it("a good minimum week returns to the held week instead of skipping it", () => {
    expect(applyDecision(at(3, { variant: "minimum" }), "advance")).toMatchObject({ pointer: 3, planWeek: 3 });
  });

  it("another bad week after a minimum week stays on minimum", () => {
    expect(applyDecision(at(3, { variant: "minimum" }), "minimum")).toMatchObject({ planWeek: 0, variant: "minimum" });
  });

  it("after a rest week, repeat resumes the held week", () => {
    expect(applyDecision(at(4, { variant: "rest" }), "repeat")).toMatchObject({ pointer: 4, planWeek: 4, variant: "normal" });
  });
});

describe("describeNextWeek", () => {
  const say = (state: PlanState, value: Parameters<typeof applyDecision>[1]) =>
    describeNextWeek(state, applyDecision(state, value));

  it("reads plainly for each outcome", () => {
    expect(say(at(1), "advance")).toBe("Move on to plan week 2");
    expect(say(at(2), "repeat")).toBe("Repeat plan week 2");
    expect(say(at(3), "step_back")).toBe("Step back to plan week 2");
    expect(say(at(3), "minimum")).toBe("Minimum week (plan week 3 on hold)");
    expect(say(at(3), "repeat_after_illness")).toBe("Easy week, then plan week 3");
    expect(say(at(3), "rest_injury")).toBe("Rest week. See a GP before riding again.");
    expect(say(at(3, { variant: "minimum" }), "advance")).toBe("Back to plan week 3");
    expect(say(at(6), "advance")).toBe("Block complete. Repeat plan week 6 until Block 2 is added");
  });
});
