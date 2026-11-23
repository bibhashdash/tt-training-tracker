import type { Metadata } from "next";
import { Suspense } from "react";
import { WeekScreen, WeekSkeleton } from "../week-screen";

export const metadata: Metadata = { title: "Week" };

export default function WeekStartPage({ params }: PageProps<"/week/[weekStart]">) {
  return (
    <Suspense fallback={<WeekSkeleton />}>
      <WeekFor params={params} />
    </Suspense>
  );
}

async function WeekFor({ params }: Pick<PageProps<"/week/[weekStart]">, "params">) {
  const { weekStart } = await params;
  return <WeekScreen requested={weekStart} />;
}
