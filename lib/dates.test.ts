import { describe, expect, it } from "vitest";
import {
  addDays,
  calendarWeek,
  dateOfWeekday,
  formatShort,
  hhmm,
  isoWeekday,
  timeIn,
  todayIn,
  weekStart,
} from "./dates";

describe("dates", () => {
  it("knows Block 1 starts on a Monday and Christmas 2026 is a Friday", () => {
    expect(isoWeekday("2026-11-23")).toBe(1);
    expect(isoWeekday("2026-12-25")).toBe(5);
    expect(isoWeekday("2026-11-29")).toBe(7);
  });

  it("finds the Monday of the week", () => {
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
    expect(weekStart("2026-11-29")).toBe("2026-11-23");
    expect(weekStart("2026-11-30")).toBe("2026-11-30");
    expect(weekStart("2027-01-03")).toBe("2026-12-28");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-12-01", -1)).toBe("2026-11-30");
    expect(dateOfWeekday("2026-12-21", 5)).toBe("2026-12-25");
  });

  it("counts calendar weeks from the block start", () => {
    expect(calendarWeek("2026-11-23", "2026-11-23")).toBe(1);
    expect(calendarWeek("2026-11-23", "2026-11-29")).toBe(1);
    expect(calendarWeek("2026-11-23", "2026-11-30")).toBe(2);
    expect(calendarWeek("2026-11-23", "2027-01-03")).toBe(6);
    expect(calendarWeek("2026-11-23", "2026-11-22")).toBe(0);
  });

  it("resolves today in London, not UTC", () => {
    // 23:30 UTC on 30 Jun 2026 is 00:30 BST on 1 Jul.
    expect(todayIn("Europe/London", new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    // In winter London is on UTC.
    expect(todayIn("Europe/London", new Date("2026-11-23T23:30:00Z"))).toBe("2026-11-23");
    expect(timeIn("Europe/London", new Date("2026-06-30T17:05:00Z"))).toBe("18:05");
  });

  it("formats for display", () => {
    expect(formatShort("2026-11-23")).toBe("Mon 23 Nov");
    expect(hhmm("07:00:00")).toBe("07:00");
    expect(hhmm(null)).toBe("");
  });
});
