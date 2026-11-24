import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActivityScreen } from "@/app/activity/[sessionId]/activity-screen";
import { getAllowedUserId } from "@/lib/auth";
import { DEFAULT_THRESHOLD } from "@/lib/hr";
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

/**
 * Practice the tuner any day: real strap or simulator, any zone, nothing saved.
 * Public: open to visitors who aren't signed in (see PUBLIC_PATHS in proxy.ts).
 */
export default function DemoPage() {
  return (
    <Suspense fallback={<div className="flex-1 animate-pulse bg-zinc-950" />}>
      <Demo />
    </Suspense>
  );
}

async function Demo() {
  await connection();
  const signedIn = (await getAllowedUserId()) !== null;
  return (
    <ActivityScreen
      session={DEMO_SESSION}
      date="1970-01-01"
      dateLabel=""
      weekday={1}
      cutoff="23:59"
      allowSimulator
      demo
      exitHref={signedIn ? "/settings" : "/login"}
      defaultThreshold={signedIn ? DEFAULT_THRESHOLD : null}
    />
  );
}
