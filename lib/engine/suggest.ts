// suggestNextWeek: week logs in, suggestion out. Pure; see docs/SPEC.md §4.2.
import { addDays, formatShort, type IsoDate } from "../dates";
import type { DailyLogIn, Reason, Suggestion, SuggestOut, WeekInput } from "./types";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function suggestNextWeek(input: WeekInput): SuggestOut {
  const { weekStart, planned, sessionLogs, dailyLogs, settings } = input;
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const inWeek = new Set(weekDates);
  const daily = new Map<IsoDate, DailyLogIn>(dailyLogs.map((d) => [d.date, d]));
  const isIll = (date: IsoDate) => (daily.get(date)?.illness ?? "none") !== "none";
  const logFor = (id: string, date: IsoDate) =>
    sessionLogs.find((l) => l.plannedSessionId === id && l.date === date);

  const reasons: Reason[] = [];
  const notes: Reason[] = []; // exclusions, listed after the main reasons

  // --- Step 1 + 2: sessions, with exclusions -----------------------------------
  let sessionsPlanned = 0;
  let sessionsDone = 0;
  let corePlanned = 0;
  let coreDone = 0;
  const offDates = new Set<IsoDate>();
  const illSessionDates = new Set<IsoDate>();

  for (const s of planned) {
    if (!inWeek.has(s.date)) continue;
    const log = logFor(s.id, s.date);
    const done = log?.status === "done";

    if (s.plannedOff || log?.status === "planned_off") {
      offDates.add(s.date);
      continue;
    }
    if (isIll(s.date) && !done) {
      illSessionDates.add(s.date);
      continue;
    }
    if (s.kind === "core") {
      corePlanned++;
      if (done) coreDone++;
    } else {
      sessionsPlanned++;
      if (done) sessionsDone++;
    }
  }

  for (const d of [...offDates].sort()) {
    notes.push({ code: "excluded_planned_off", text: `${formatShort(d)} planned off, not counted.` });
  }
  for (const d of [...illSessionDates].sort()) {
    notes.push({ code: "excluded_illness", text: `${formatShort(d)} ill, session not counted.` });
  }

  const completionPct = sessionsPlanned === 0 ? 100 : Math.round((sessionsDone / sessionsPlanned) * 100);

  // --- Sleep: the night before each day; skip illness days and the morning after a planned indulgence.
  let shortSleepNights = 0;
  let indulgenceMornings = 0;
  for (const date of weekDates) {
    const d = daily.get(date);
    if (!d || d.sleepHours === null || isIll(date)) continue;
    if (daily.get(addDays(date, -1))?.plannedIndulgence) {
      if (d.sleepHours < settings.sleepThresholdHours) indulgenceMornings++;
      continue;
    }
    if (d.sleepHours < settings.sleepThresholdHours) shortSleepNights++;
  }

  // --- Diet: unplanned off-plan days; planned indulgences and illness days don't count.
  let offPlanDays = 0;
  for (const date of weekDates) {
    const d = daily.get(date);
    if (!d || isIll(date) || d.plannedIndulgence) continue;
    if (d.dietOk === false || d.unplannedTreat) offPlanDays++;
  }

  if (indulgenceMornings > 0) {
    notes.push({
      code: "excluded_indulgence_sleep",
      text: `${plural(indulgenceMornings, "short night")} after a planned indulgence, not counted.`,
    });
  }

  // --- Illness: longest consecutive run of ill days that touches this week (may start last week).
  let illnessDays = 0;
  let run = 0;
  let runTouchesWeek = false;
  for (let i = -7; i < 7; i++) {
    const date = addDays(weekStart, i);
    if (isIll(date)) {
      run++;
      if (inWeek.has(date)) runTouchesWeek = true;
      if (runTouchesWeek) illnessDays = Math.max(illnessDays, run);
    } else {
      run = 0;
      runTouchesWeek = false;
    }
  }

  // --- Injury: any note in the week.
  const injuryDate = weekDates.find((date) => (daily.get(date)?.injuryNote ?? "").trim() !== "");

  // --- Step 3: flags ---------------------------------------------------------
  const flags = {
    sessions: completionPct < settings.completionAdvancePct,
    sleep: shortSleepNights >= settings.sleepFlagNights,
    diet: offPlanDays >= settings.dietFlagDays,
    count: 0,
  };
  flags.count = Number(flags.sessions) + Number(flags.sleep) + Number(flags.diet);

  const completionText =
    sessionsPlanned === 0
      ? "No rides to count this week."
      : `${sessionsDone} of ${plural(sessionsPlanned, "ride")} done (${completionPct}%). ${settings.completionAdvancePct}% needed to move on.`;
  const sleepText = `${plural(shortSleepNights, "night")} under ${settings.sleepThresholdHours} h (flag at ${settings.sleepFlagNights}).`;
  const dietText = `${plural(offPlanDays, "unplanned off-plan day")} (flag at ${settings.dietFlagDays}).`;

  // --- Step 4: precedence, first match wins ----------------------------------
  let suggestion: Suggestion;
  if (injuryDate) {
    suggestion = "rest_injury";
    reasons.push({
      code: "injury",
      text: `Injury noted on ${formatShort(injuryDate)}. Rest and see a GP before riding again.`,
    });
  } else if (illnessDays >= 7) {
    suggestion = "step_back";
    reasons.push({ code: "illness_long", text: `Ill for ${illnessDays} days in a row. Step back one plan week.` });
  } else if (illnessDays >= 3) {
    suggestion = "repeat_after_illness";
    reasons.push({
      code: "illness",
      text: `Ill for ${illnessDays} days in a row. An easy week first, then repeat this plan week.`,
    });
  } else if (sessionsPlanned === 0) {
    suggestion = "repeat";
    reasons.push({ code: "nothing_to_count", text: "No rides to count this week, so nothing to move on from." });
  } else if (flags.count >= 2 || completionPct < settings.completionMinimumPct) {
    suggestion = "minimum";
    if (completionPct < settings.completionMinimumPct) {
      reasons.push({
        code: "completion_low",
        text: `${sessionsDone} of ${plural(sessionsPlanned, "ride")} done (${completionPct}%), under ${settings.completionMinimumPct}%.`,
      });
    }
    if (flags.count >= 2) {
      reasons.push({ code: "flags", text: `${flags.count} warning signs this week. A lighter week resets things.` });
    }
  } else if (completionPct >= settings.completionAdvancePct) {
    suggestion = "advance";
    reasons.push({ code: "completion", text: completionText });
  } else {
    suggestion = "repeat";
    reasons.push({ code: "completion", text: completionText });
  }

  // Every flag that's set gets its own reason (unless it's already the headline reason).
  const has = (code: string) => reasons.some((r) => r.code === code);
  if (flags.sessions && !has("completion") && !has("completion_low") && sessionsPlanned > 0) {
    reasons.push({ code: "flag_sessions", text: completionText });
  }
  if (flags.sleep) reasons.push({ code: "flag_sleep", text: `Sleep: ${sleepText}` });
  if (flags.diet) reasons.push({ code: "flag_diet", text: `Diet: ${dietText}` });

  return {
    suggestion,
    reasons: [...reasons, ...notes],
    stats: {
      sessionsPlanned,
      sessionsDone,
      completionPct,
      corePlanned,
      coreDone,
      shortSleepNights,
      offPlanDays,
      illnessDays,
    },
    flags,
  };
}
