import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAllowedUserId } from "@/lib/auth";
import { loadSettings } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { LiveRideScreen } from "../live-ride-screen";

export const metadata: Metadata = { title: "Live zones demo" };

/**
 * Practice the live zone screen any day: heart rate strap and/or smart trainer,
 * real or simulated, nothing saved.
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
  // Visitors enter their own numbers; the rider's come from their settings.
  const settings = signedIn ? await loadSettings(await createClient()) : null;
  return (
    <LiveRideScreen
      mode={{ kind: "demo", exitHref: signedIn ? "/settings" : "/login" }}
      threshold={settings?.threshold_hr ?? null}
      ftp={settings?.ftp ?? null}
      allowSimulator
    />
  );
}
