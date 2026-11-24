import { Check, ChevronLeft, ChevronRight, Circle, CircleAlert, Minus, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Card, Stat } from "@/components/ui";
import { formatShort } from "@/lib/dates";
import { canLogDate } from "@/lib/session-rules";
import type { DailyLog } from "@/lib/types";
import { getWeekView } from "@/lib/week";
import type { DaySession, SessionState } from "@/lib/week-days";

const STATE: Record<SessionState, { Icon: LucideIcon; label: string; cls: string }> = {
  done: { Icon: Check, label: "done", cls: "text-emerald-600 dark:text-emerald-400" },
  dropped: { Icon: X, label: "dropped", cls: "text-zinc-400" },
  planned_off: { Icon: Minus, label: "planned off", cls: "text-zinc-400" },
  missed: { Icon: CircleAlert, label: "not logged", cls: "text-amber-600 dark:text-amber-400" },
  pending: { Icon: Circle, label: "to do", cls: "text-zinc-300 dark:text-zinc-600" },
};

export async function WeekScreen({ requested }: { requested?: string }) {
  const v = await getWeekView(requested);
  const { weekPlan, result, settings, totals } = v;
  const pw = weekPlan?.plan_week;
  const gap = weekPlan ? v.calendarWeek - weekPlan.pointer : 0;

  const planLabel = !weekPlan
    ? "No plan"
    : !pw
      ? `Rest week · plan wk ${weekPlan.pointer} on hold`
      : pw.plan_week === 0
        ? `Minimum week · plan wk ${weekPlan.pointer} on hold`
        : weekPlan.variant === "easy_return"
          ? `Easy return · then plan wk ${weekPlan.pending_after ?? weekPlan.pointer}`
          : `Plan wk ${pw.plan_week} · ${pw.type}`;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-2">
        <NavArrow href={v.prevWeek ? `/week/${v.prevWeek}` : null} label="Previous week" Icon={ChevronLeft} />
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">Week of {formatShort(v.weekStart)}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {planLabel}
            {weekPlan && v.calendarWeek >= 1 && (
              <>
                {" "}
                · calendar wk {v.calendarWeek}
                {gap > 0 && `, ${gap} behind`}
              </>
            )}
          </p>
        </div>
        <NavArrow href={v.nextWeek ? `/week/${v.nextWeek}` : null} label="Next week" Icon={ChevronRight} />
      </header>

      {!weekPlan ? (
        <Card>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {v.weekStart < settings.block_start_date
              ? "This is before the block started."
              : "No plan was scheduled for this week."}
          </p>
        </Card>
      ) : (
        <>
          {result && (
            <>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat
                  label={v.inProgress ? "Rides so far" : "Rides"}
                  value={`${result.stats.sessionsDone}/${result.stats.sessionsPlanned}`}
                  sub={`${result.stats.completionPct}% · ${settings.completion_advance_pct}% to move on`}
                  flagged={result.flags.sessions && result.stats.sessionsPlanned > 0}
                />
                <Stat
                  label="Short nights"
                  value={String(result.stats.shortSleepNights)}
                  sub={`flag at ${settings.sleep_flag_nights}`}
                  flagged={result.flags.sleep}
                />
                <Stat
                  label="Off-plan days"
                  value={String(result.stats.offPlanDays)}
                  sub={`flag at ${settings.diet_flag_days}`}
                  flagged={result.flags.diet}
                />
              </dl>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {totals.doneMinutes} of {totals.plannedMinutes} min ridden
                {result.stats.corePlanned > 0 && ` · core ${result.stats.coreDone}/${result.stats.corePlanned}`}
              </p>
            </>
          )}

          {v.review ? (
            <Link href={`/review/${v.weekStart}`} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Reviewed · {v.review.decision}
                </span>
                <span className="block font-medium">{v.headline}</span>
              </span>
              <ChevronRight aria-hidden className="text-zinc-400" size={20} />
            </Link>
          ) : v.reviewOpen ? (
            <Link href={`/review/${v.weekStart}`} className="flex items-center justify-between rounded-xl bg-zinc-900 p-4 text-white dark:bg-zinc-100 dark:text-zinc-900">
              <span>
                <span className="block font-semibold">Review this week</span>
                <span className="block text-sm opacity-80">Suggestion: {v.headline}</span>
              </span>
              <ChevronRight aria-hidden size={20} />
            </Link>
          ) : (
            v.headline && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                If the week ended now: <span className="font-medium">{v.headline}</span>
              </p>
            )
          )}

          <ul className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {v.days.map((d) => {
              const editable = !v.review && canLogDate(d.date, v.today);
              const isToday = d.date === v.today;
              const row = (
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className={`w-14 shrink-0 text-sm ${isToday ? "font-semibold" : "text-zinc-600 dark:text-zinc-400"}`}>
                    {formatShort(d.date).split(" ").slice(0, 2).join(" ")}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    {d.sessions.length === 0 && d.unplanned.length === 0 && <span className="text-zinc-400">Rest</span>}
                    {d.sessions.map((ds) => (
                      <SessionLine key={ds.session.id} ds={ds} />
                    ))}
                    {d.unplanned.map((u) => (
                      <span key={u.id} className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
                        <Check aria-hidden size={16} className="text-zinc-400" />
                        Unplanned · {u.actual_minutes} min
                        {u.avg_power !== null && ` · ${u.avg_power} W`}
                      </span>
                    ))}
                  </div>
                  <DailySummary daily={d.daily} threshold={Number(settings.sleep_threshold_hours)} />
                </div>
              );
              return (
                <li key={d.date} className={isToday ? "bg-zinc-50 dark:bg-zinc-800/50" : ""}>
                  {editable ? (
                    <Link href={isToday ? "/today" : `/today?date=${d.date}`} className="block active:bg-zinc-100 dark:active:bg-zinc-800">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function SessionLine({ ds }: { ds: DaySession }) {
  const { Icon, label, cls } = STATE[ds.state];
  const s = ds.session;
  const minutes =
    ds.state === "done" && ds.log?.actual_minutes
      ? `${ds.log.actual_minutes} of ${s.target_minutes} min${ds.log.avg_power !== null ? ` · ${ds.log.avg_power} W` : ""}`
      : `${s.target_minutes} min`;
  return (
    <span className="flex items-center gap-2">
      <Icon aria-hidden size={16} className={`shrink-0 ${cls}`} />
      <span className={ds.state === "dropped" || ds.state === "planned_off" ? "text-zinc-400 line-through" : ""}>
        {s.kind === "core" ? "Core" : "Ride"} · {minutes}
        {s.kind === "ride" && s.zone && <span className="text-zinc-500"> · {s.zone}</span>}
      </span>
      <span className="sr-only">({label})</span>
    </span>
  );
}

function DailySummary({ daily, threshold }: { daily: DailyLog | null; threshold: number }) {
  if (!daily) return <span className="shrink-0 text-xs text-zinc-300 dark:text-zinc-600">no log</span>;
  const sleep = daily.sleep_hours === null ? null : Number(daily.sleep_hours);
  const offPlan = !daily.planned_indulgence && (daily.diet_ok === false || daily.unplanned_drink_or_treat);
  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5 text-xs">
      {sleep !== null && (
        <span className={sleep < threshold ? "font-medium text-amber-700 dark:text-amber-400" : "text-zinc-500"}>{sleep} h</span>
      )}
      {daily.illness !== "none" ? (
        <span className="text-zinc-500">ill</span>
      ) : daily.planned_indulgence ? (
        <span className="text-zinc-500">planned treat</span>
      ) : offPlan ? (
        <span className="font-medium text-amber-700 dark:text-amber-400">off plan</span>
      ) : null}
    </span>
  );
}

function NavArrow({ href, label, Icon }: { href: string | null; label: string; Icon: LucideIcon }) {
  if (!href) return <span className="h-11 w-11" />;
  return (
    <Link href={href} aria-label={label} className="flex h-11 w-11 items-center justify-center rounded-lg active:bg-zinc-100 dark:active:bg-zinc-800">
      <Icon aria-hidden size={22} />
    </Link>
  );
}

export function WeekSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-5" aria-busy="true" aria-label="Loading">
      <div className="mx-auto h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-20 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-96 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
