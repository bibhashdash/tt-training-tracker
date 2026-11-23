import type { Metadata } from "next";
import { Suspense } from "react";
import { WeekScreen, WeekSkeleton } from "./week-screen";

export const metadata: Metadata = { title: "Week" };

/** /week is the current week. */
export default function WeekPage() {
  return (
    <Suspense fallback={<WeekSkeleton />}>
      <WeekScreen />
    </Suspense>
  );
}
