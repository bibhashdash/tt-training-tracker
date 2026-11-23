import type { Metadata } from "next";
import { Suspense } from "react";
import { DailyLogScreen, DailyLogSkeleton } from "../daily-log-screen";

export const metadata: Metadata = { title: "Daily log" };

export default function LogDatePage({ params }: PageProps<"/log/[date]">) {
  return (
    <Suspense fallback={<DailyLogSkeleton />}>
      <LogForDate params={params} />
    </Suspense>
  );
}

async function LogForDate({ params }: Pick<PageProps<"/log/[date]">, "params">) {
  const { date } = await params;
  return <DailyLogScreen requested={date} />;
}
