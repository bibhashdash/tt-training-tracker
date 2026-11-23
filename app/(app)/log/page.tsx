import type { Metadata } from "next";
import { Suspense } from "react";
import { DailyLogScreen, DailyLogSkeleton } from "./daily-log-screen";

export const metadata: Metadata = { title: "Daily log" };

/** /log is today's log. */
export default function LogPage() {
  return (
    <Suspense fallback={<DailyLogSkeleton />}>
      <DailyLogScreen />
    </Suspense>
  );
}
