"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { weekStart } from "@/lib/dates";
import { loadSettings, todayFor } from "@/lib/queries";
import { canLogDate } from "@/lib/session-rules";
import { parseDailyLog, parseSessionLog } from "@/lib/validation";

export type ActionResult = { ok: true } | { ok: false; error: string };

const TOO_FAR = "You can only log today and days back to last Monday.";

/**
 * Create or update the log for a planned session on a date, or add an
 * unplanned ride. The DB also enforces that a session is logged on its own weekday.
 */
export async function saveSessionLog(input: unknown): Promise<ActionResult> {
  const parsed = parseSessionLog(input);
  if (!parsed.ok) return parsed;
  const values = parsed.value;

  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);
  if (!canLogDate(values.date, todayFor(settings))) return { ok: false, error: TOO_FAR };

  if (values.planned_session_id === null) {
    const { error } = await supabase.from("session_logs").insert(values);
    if (error) return { ok: false, error: error.message };
    refresh();
    return { ok: true };
  }

  // The session must belong to the plan week scheduled for that calendar week.
  const [{ data: session }, { data: plan }] = await Promise.all([
    supabase.from("planned_sessions").select("plan_week_id").eq("id", values.planned_session_id).maybeSingle(),
    supabase.from("week_plans").select("plan_week_id").eq("week_start", weekStart(values.date)).maybeSingle(),
  ]);
  if (!session || !plan || session.plan_week_id !== plan.plan_week_id) {
    return { ok: false, error: "That session isn't in this week's plan." };
  }

  const { data: existing, error: findError } = await supabase
    .from("session_logs")
    .select("id")
    .eq("planned_session_id", values.planned_session_id)
    .eq("date", values.date)
    .maybeSingle();
  if (findError) return { ok: false, error: findError.message };

  const { error } = existing
    ? await supabase.from("session_logs").update(values).eq("id", existing.id)
    : await supabase.from("session_logs").insert(values);
  if (error) return { ok: false, error: error.message };

  refresh();
  return { ok: true };
}

/** Clears a log (undo a drop, or remove an unplanned ride). */
export async function deleteSessionLog(id: unknown): Promise<ActionResult> {
  if (typeof id !== "string") return { ok: false, error: "Bad request." };
  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);

  const { data: log } = await supabase.from("session_logs").select("date").eq("id", id).maybeSingle();
  if (!log) return { ok: false, error: "Log not found." };
  if (!canLogDate(log.date, todayFor(settings))) return { ok: false, error: TOO_FAR };

  const { error } = await supabase.from("session_logs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** Upserts the whole daily log for one date. Called on every change (autosave). */
export async function saveDailyLog(input: unknown): Promise<ActionResult> {
  const parsed = parseDailyLog(input);
  if (!parsed.ok) return parsed;

  const { supabase, userId } = await requireUser();
  const settings = await loadSettings(supabase);
  if (!canLogDate(parsed.value.date, todayFor(settings))) return { ok: false, error: TOO_FAR };

  const { error } = await supabase
    .from("daily_logs")
    .upsert({ ...parsed.value, user_id: userId }, { onConflict: "user_id,date" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
