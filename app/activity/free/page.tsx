import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { formatShort, isoWeekday, weekStart } from "@/lib/dates";
import { loadSettings, loadWeekPlan, todayFor } from "@/lib/queries";
import { isWeekLocked } from "@/lib/review";
import { LiveRideScreen } from "../live-ride-screen";

export const metadata: Metadata = { title: "Free ride" };

/**
 * A ride started from the Today button, not tied to a session up front. At the
 * end it can count as today's planned ride (if one is still to log) or be
 * logged as an unplanned ride.
 */
export default function FreeRidePage({ searchParams }: PageProps<"/activity/free">) {
  return (
    <Suspense fallback={<div className="flex-1 animate-pulse bg-zinc-950" />}>
      <FreeRide searchParams={searchParams} />
    </Suspense>
  );
}

async function FreeRide({ searchParams }: Pick<PageProps<"/activity/free">, "searchParams">) {
  await connection();
  const query = await searchParams;
  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);
  const today = todayFor(settings);
  const weekday = isoWeekday(today);

  const [locked, weekPlan, logs] = await Promise.all([
    isWeekLocked(supabase, today),
    loadWeekPlan(supabase, weekStart(today)),
    supabase.from("session_logs").select("planned_session_id").eq("date", today),
  ]);

  if (locked) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4">
        <h1 className="text-2xl font-semibold">Can&apos;t record a ride today</h1>
        <p className="text-zinc-600 dark:text-zinc-400">This week has been reviewed and is locked.</p>
        <Link href="/today" className="font-medium underline">
          Back to Today
        </Link>
      </main>
    );
  }

  // Today's planned ride, if it's still to log and not a planned-off day.
  const logged = new Set((logs.data ?? []).map((l) => l.planned_session_id));
  const todaysRide =
    settings.planned_off_dates.includes(today)
      ? null
      : (weekPlan?.plan_week?.planned_sessions.find(
          (s) => s.weekday === weekday && s.kind === "ride" && !logged.has(s.id),
        ) ?? null);

  return (
    <LiveRideScreen
      mode={{ kind: "free", date: today, dateLabel: formatShort(today), weekday, todaysRide }}
      threshold={settings.threshold_hr}
      ftp={settings.ftp}
      allowSimulator={query.sim === "1"}
    />
  );
}
