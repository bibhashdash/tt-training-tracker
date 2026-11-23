import type { Metadata } from "next";
import { Suspense } from "react";
import { dateOfWeekday, formatShort, hhmm, isoWeekday, weekdayShort } from "@/lib/dates";
import { getWeekContext } from "@/lib/queries";
import type { PlannedSession, WeekVariant } from "@/lib/types";

export const metadata: Metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <Suspense fallback={<TodaySkeleton />}>
      <Today />
    </Suspense>
  );
}

const VARIANT_LABEL: Record<WeekVariant, string | null> = {
  normal: null,
  minimum: "Minimum week",
  easy_return: "Easy return",
  rest: "Rest week",
};

async function Today() {
  const { today, weekStart, calendarWeek, settings, weekPlan } = await getWeekContext();
  const weekday = isoWeekday(today);
  const plannedOff = settings.planned_off_dates.includes(today);

  const gap = weekPlan ? calendarWeek - weekPlan.pointer : 0;
  const variant = weekPlan ? VARIANT_LABEL[weekPlan.variant] : null;
  const sessions = weekPlan?.plan_week?.planned_sessions ?? [];
  const todays = sessions.filter((s) => s.weekday === weekday);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{formatShort(today)}</h1>
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

      {!weekPlan ? (
        <Card>
          <p className="font-medium">No plan for this week yet.</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Next week&apos;s plan is set by the Sunday review (coming in milestone 3).
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
            <SessionCard key={s.id} session={s} plannedOff={plannedOff} />
          ))}
        </section>
      )}

      {sessions.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            This week · {weekPlan?.plan_week?.type} · {weekPlan?.plan_week?.target_minutes} min
          </h2>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {sessions.map((s) => {
              const date = dateOfWeekday(weekStart, s.weekday);
              const off = settings.planned_off_dates.includes(date);
              return (
                <li
                  key={s.id}
                  className={`flex items-center justify-between px-4 py-3 text-sm ${
                    s.weekday === weekday ? "font-semibold" : ""
                  } ${off ? "text-zinc-400 line-through" : ""}`}
                >
                  <span>
                    {weekdayShort(s.weekday)} · {s.kind === "core" ? "Core" : "Ride"}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {s.target_minutes} min{s.zone ? ` · ${s.zone}` : ""}
                    {s.is_key && " · key"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function SessionCard({ session: s, plannedOff }: { session: PlannedSession; plannedOff: boolean }) {
  const backupCap = s.backup_max_minutes ?? s.max_minutes;
  return (
    <Card>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-lg font-semibold">
          {s.kind === "core" ? "Core & mobility" : "Ride"} · {s.target_minutes} min
          {s.zone && <span className="font-normal text-zinc-600 dark:text-zinc-400"> · {s.zone}</span>}
        </p>
        {s.is_key && (
          <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900">
            Key
          </span>
        )}
      </div>
      {s.description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.description}</p>}
      <p className="mt-2 text-sm">
        {hhmm(s.primary_slot)}
        {s.backup_slot && (
          <span className="text-zinc-600 dark:text-zinc-400">
            {" "}
            (backup {hhmm(s.backup_slot)}
            {backupCap !== null && backupCap < s.target_minutes ? `, ${backupCap} min max` : ""})
          </span>
        )}
      </p>
      {plannedOff && <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">Planned off today.</p>}
      <p className="mt-3 text-xs text-zinc-500">Logging arrives in milestone 2.</p>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">{children}</div>
  );
}

function TodaySkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-32 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-48 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
