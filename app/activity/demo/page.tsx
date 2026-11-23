import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActivityScreen } from "@/app/activity/[sessionId]/activity-screen";
import { requireUser } from "@/lib/auth";
import type { PlannedSession } from "@/lib/types";

export const metadata: Metadata = { title: "Heart rate demo" };

/** A stand-in session so the activity screen can run with no plan behind it. */
const DEMO_SESSION: PlannedSession = {
  id: "demo",
  weekday: 1,
  kind: "ride",
  target_minutes: 30,
  max_minutes: null,
  backup_max_minutes: null,
  zone: "Z2",
  is_key: false,
  primary_slot: "07:00",
  backup_slot: null,
  description: null,
};

/** Practice the tuner any day: real strap or simulator, any zone, nothing saved. */
export default function DemoPage() {
  return (
    <Suspense fallback={<div className="flex-1 animate-pulse bg-zinc-950" />}>
      <Demo />
    </Suspense>
  );
}

async function Demo() {
  await connection();
  await requireUser();
  return (
    <ActivityScreen
      session={DEMO_SESSION}
      date="1970-01-01"
      dateLabel=""
      weekday={1}
      cutoff="23:59"
      allowSimulator
      demo
    />
  );
}
