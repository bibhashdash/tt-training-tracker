import Link from "next/link";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { addDays, formatShort, isoWeekday, weekStart } from "@/lib/dates";
import { loadSettings, todayFor } from "@/lib/queries";
import { canLogDate } from "@/lib/session-rules";
import type { DailyLog } from "@/lib/types";
import { DailyLogForm } from "./daily-log-form";

/** Server part of the daily log: picks the date, loads the existing row, renders the form. */
export async function DailyLogScreen({ requested }: { requested?: string }) {
  await connection();
  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);
  const today = todayFor(settings);
  const date = requested && canLogDate(requested, today) ? requested : today;

  const { data, error } = await supabase.from("daily_logs").select("*").eq("date", date).maybeSingle<DailyLog>();
  if (error) throw error;

  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const earliest = addDays(weekStart(today), -7);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-2">
        {prev >= earliest ? (
          <Link href={`/log/${prev}`} aria-label="Previous day" className="flex h-11 w-11 items-center justify-center rounded-lg text-xl">
            ‹
          </Link>
        ) : (
          <span className="w-11" />
        )}
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">{date === today ? "Today" : formatShort(date)}</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{date === today ? formatShort(date) : "Daily log"}</p>
        </div>
        {next <= today ? (
          <Link href={`/log/${next}`} aria-label="Next day" className="flex h-11 w-11 items-center justify-center rounded-lg text-xl">
            ›
          </Link>
        ) : (
          <span className="w-11" />
        )}
      </header>
      <DailyLogForm key={date} date={date} isFriday={isoWeekday(date) === 5} initial={data} />
    </div>
  );
}

export function DailyLogSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="mx-auto h-8 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-28 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-44 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
