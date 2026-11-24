import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { formatShort, hhmm, isoWeekday, weekStart } from "@/lib/dates";
import { loadSettings, todayFor } from "@/lib/queries";
import { isWeekLocked } from "@/lib/review";
import type { PlannedSession } from "@/lib/types";
import { LiveRideScreen } from "../live-ride-screen";

export const metadata: Metadata = { title: "Activity" };

/** Full-screen ride view (no tab bar). Only for today's planned rides. */
export default function ActivityPage({ params, searchParams }: PageProps<"/activity/[sessionId]">) {
  return (
    <Suspense fallback={<div className="flex-1 animate-pulse bg-zinc-950" />}>
      <Activity params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Activity({ params, searchParams }: PageProps<"/activity/[sessionId]">) {
  await connection();
  const [{ sessionId }, query] = await Promise.all([params, searchParams]);
  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);
  const today = todayFor(settings);

  const { data: session } = await supabase
    .from("planned_sessions")
    .select("id, plan_week_id, weekday, kind, target_minutes, max_minutes, backup_max_minutes, zone, is_key, primary_slot, backup_slot, description")
    .eq("id", sessionId)
    .maybeSingle<PlannedSession & { plan_week_id: string }>();
  const [{ data: plan }, { data: existing }, locked] = await Promise.all([
    supabase.from("week_plans").select("plan_week_id").eq("week_start", weekStart(today)).maybeSingle(),
    supabase.from("session_logs").select("id").eq("planned_session_id", sessionId).eq("date", today).maybeSingle(),
    isWeekLocked(supabase, today),
  ]);

  const problem = !session
    ? "That session doesn't exist."
    : session.kind !== "ride"
      ? "Activities are for rides."
      : !plan || plan.plan_week_id !== session.plan_week_id || session.weekday !== isoWeekday(today)
        ? "That ride isn't on today's plan."
        : existing
          ? "This ride is already logged for today."
          : locked
            ? "This week has been reviewed and is locked."
            : null;

  if (problem || !session) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold">Can&apos;t start this activity</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{problem}</p>
        <Link href="/today" className="font-medium underline">
          Back to Today
        </Link>
      </main>
    );
  }

  return (
    <LiveRideScreen
      mode={{
        kind: "planned",
        session,
        date: today,
        dateLabel: formatShort(today),
        weekday: isoWeekday(today),
        cutoff: hhmm(settings.cutoff_time),
      }}
      threshold={settings.threshold_hr}
      ftp={settings.ftp}
      allowSimulator={query.sim === "1"}
    />
  );
}
