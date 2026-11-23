import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import {
  addDays,
  dateOfWeekday,
  formatShort,
  hhmm,
  isoWeekday,
  timeIn,
  weekdayShort,
  weekStart,
  type Weekday,
} from "@/lib/dates";
import { requireUser } from "@/lib/auth";
import { getDayContext, type DayContext } from "@/lib/queries";
import { getPendingReview, isWeekLocked } from "@/lib/review";
import { tooLateForKey } from "@/lib/session-rules";
import type { WeekVariant } from "@/lib/types";
import { SessionCard } from "./session-card";
import { UnplannedRides } from "./unplanned-rides";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage({ searchParams }: PageProps<"/today">) {
  return (
    <Suspense fallback={<TodaySkeleton />}>
      <Today searchParams={searchParams} />
    </Suspense>
  );
}

const VARIANT_LABEL: Record<WeekVariant, string | null> = {
  normal: null,
  minimum: "Minimum week",
  easy_return: "Easy return",
  rest: "Rest week",
};

async function Today({ searchParams }: Pick<PageProps<"/today">, "searchParams">) {
  const { date: requested } = await searchParams;
  const ctx = await getDayContext(typeof requested === "string" ? requested : undefined);
  const { today, date, calendarWeek, settings, weekPlan, sessionLogs, dailyLog } = ctx;
  const { supabase } = await requireUser();
  const [pendingReview, locked] = await Promise.all([
    getPendingReview(supabase, settings, today),
    isWeekLocked(supabase, date),
  ]);

  const weekday = isoWeekday(date);
  const isToday = date === today;
  const plannedOff = settings.planned_off_dates.includes(date);
  const cutoff = hhmm(settings.cutoff_time);
  const now = timeIn(settings.timezone, new Date());

  const gap = weekPlan ? calendarWeek - weekPlan.pointer : 0;
  const variant = weekPlan ? VARIANT_LABEL[weekPlan.variant] : null;
  const sessions = weekPlan?.plan_week?.planned_sessions ?? [];
  const todays = sessions.filter((s) => s.weekday === weekday);
  const unplanned = sessionLogs.filter((l) => l.planned_session_id === null);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{isToday ? `Today · ${formatShort(date)}` : formatShort(date)}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <span>
            Calendar wk {calendarWeek}
            {weekPlan && (
              <>
                {" "}
                · Plan wk {weekPlan.pointer}
                {gap > 0 && ` (${gap} behind)`}
              </>
            )}
          </span>
          {variant && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              {variant}
            </span>
          )}
        </p>
      </header>

      {pendingReview && (
        <Link
          href={`/review/${pendingReview.weekStart}`}
          className="flex items-center justify-between gap-3 rounded-xl bg-zinc-900 p-4 text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          <span>
            <span className="block font-semibold">
              Review the week of {formatShort(pendingReview.weekStart)}
            </span>
            <span className="block text-sm opacity-80">
              {pendingReview.blocking
                ? "Next week's plan is set by the review. Finish any missing logs first."
                : "The week's done. See the suggestion for next week."}
            </span>
          </span>
          <span aria-hidden className="text-xl">
            ›
          </span>
        </Link>
      )}

      <DayStrip ctx={ctx} />

      {locked && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          This week has been reviewed, so its logs are read-only.
        </p>
      )}

      {!weekPlan ? (
        <Card>
          <p className="font-medium">No plan for this week yet.</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {pendingReview?.blocking
              ? "Review last week (above) and the plan for this week appears here."
              : "Each week's plan is set by the Sunday review."}
          </p>
        </Card>
      ) : weekPlan.variant === "rest" ? (
        <Card>
          <p className="font-medium">Rest week</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">No riding planned. Rest, and see a GP if the injury persists.</p>
        </Card>
      ) : (
        <section className="flex flex-col gap-3">
          {todays.length === 0 && (
            <Card>
              <p className="font-medium">Rest day</p>
            </Card>
          )}
          {todays.map((s) => (
            <SessionCard
              key={`${s.id}-${date}`}
              session={s}
              log={sessionLogs.find((l) => l.planned_session_id === s.id) ?? null}
              date={date}
              weekday={weekday}
              plannedOff={plannedOff}
              tooLate={isToday && tooLateForKey(s, now, cutoff)}
              cutoff={cutoff}
              locked={locked}
              canStartActivity={isToday && !locked && !plannedOff}
            />
          ))}
        </section>
      )}

      <UnplannedRides key={date} rides={unplanned} date={date} weekday={weekday} locked={locked} />

      <Link
        href={`/log/${date}`}
        className={`flex items-center justify-between rounded-xl border p-4 ${
          dailyLog
            ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
        }`}
      >
        <span>
          <span className="block font-medium">{dailyLog ? "Daily log" : "Log sleep and diet"}</span>
          <span className="block text-sm text-zinc-600 dark:text-zinc-400">
            {dailyLog
              ? [
                  dailyLog.sleep_hours !== null ? `${dailyLog.sleep_hours} h sleep` : "Sleep not logged",
                  dailyLog.diet_ok === false || dailyLog.unplanned_drink_or_treat ? "off plan" : "diet OK",
                  dailyLog.illness !== "none" ? "ill" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "Not done yet for this day"}
          </span>
        </span>
        <span aria-hidden className="text-zinc-400">
          ›
        </span>
      </Link>
    </div>
  );
}

/** Mon-Sun of the selected week. Past days can be backfilled; the future can't be opened. */
function DayStrip({ ctx }: { ctx: DayContext }) {
  const { today, date, weekStart: monday, weekPlan, weekLogs, settings } = ctx;
  const sessions = weekPlan?.plan_week?.planned_sessions ?? [];
  const thisMonday = weekStart(today);
  const viewingLastWeek = monday < thisMonday;

  return (
    <nav aria-label="Days" className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1">
        {([1, 2, 3, 4, 5, 6, 7] as Weekday[]).map((wd) => {
          const d = dateOfWeekday(monday, wd);
          const future = d > today;
          const selected = d === date;
          const planned = sessions.filter((s) => s.weekday === wd && s.kind === "ride");
          const off = settings.planned_off_dates.includes(d);
          const logged = planned.filter((s) => weekLogs.some((l) => l.planned_session_id === s.id && l.date === d));
          const state =
            planned.length === 0 || off
              ? "none"
              : logged.length === planned.length
                ? "logged"
                : d < today
                  ? "missing"
                  : "planned";

          const content = (
            <>
              <span className="text-xs">{weekdayShort(wd)}</span>
              <span className="text-base font-semibold">{Number(d.slice(8))}</span>
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${
                  state === "logged"
                    ? "bg-emerald-500"
                    : state === "missing"
                      ? "bg-amber-500"
                      : state === "planned"
                        ? "bg-zinc-400"
                        : "bg-transparent"
                }`}
              />
            </>
          );
          const cls = `flex h-16 flex-col items-center justify-center gap-0.5 rounded-lg ${
            selected
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : future
                ? "text-zinc-300 dark:text-zinc-700"
                : "bg-white text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          }`;
          return future ? (
            <span key={d} className={cls} aria-disabled>
              {content}
            </span>
          ) : (
            <Link
              key={d}
              href={d === today ? "/today" : `/today?date=${d}`}
              aria-current={selected ? "date" : undefined}
              aria-label={`${formatShort(d)}${state === "missing" ? ", not logged" : state === "logged" ? ", logged" : ""}`}
              className={cls}
            >
              {content}
            </Link>
          );
        })}
      </div>
      <div className="flex justify-between text-sm">
        {viewingLastWeek ? (
          <Link href="/today" className="text-zinc-600 dark:text-zinc-400">
            Back to this week ›
          </Link>
        ) : (
          <Link href={`/today?date=${addDays(thisMonday, -1)}`} className="text-zinc-600 dark:text-zinc-400">
            ‹ Last week
          </Link>
        )}
      </div>
    </nav>
  );
}

function TodaySkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-16 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-40 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-16 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
