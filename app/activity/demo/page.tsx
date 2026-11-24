import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAllowedUserId } from "@/lib/auth";
import { DEFAULT_THRESHOLD } from "@/lib/hr";
import { DEFAULT_FTP } from "@/lib/power";
import { DemoScreen } from "./demo-screen";

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
  // Visitors enter their own numbers; the rider's are prefilled.
  return (
    <DemoScreen
      exitHref={signedIn ? "/settings" : "/login"}
      defaultThreshold={signedIn ? DEFAULT_THRESHOLD : null}
      defaultFtp={signedIn ? DEFAULT_FTP : null}
    />
  );
}
