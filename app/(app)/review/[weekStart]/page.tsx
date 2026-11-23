import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Stat } from "@/components/ui";
import { addDays, formatShort } from "@/lib/dates";
import { applyDecision, describeNextWeek } from "@/lib/engine/decide";
import { getReviewContext } from "@/lib/review";
import { canLogDate } from "@/lib/session-rules";
import { isIsoDate } from "@/lib/validation";
import { ReviewForm } from "./review-form";

export const metadata: Metadata = { title: "Weekly review" };

export default function ReviewPage({ params }: PageProps<"/review/[weekStart]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" aria-busy="true" />}>
      <Review params={params} />
    </Suspense>
  );
}

const TYPE_LABEL = { habits: "habits", build: "build", easy: "easy", minimum: "minimum" } as const;

async function Review({ params }: Pick<PageProps<"/review/[weekStart]">, "params">) {
  const { weekStart: raw } = await params;
  if (!isIsoDate(raw)) return <Message title="Not a week">That link doesn&apos;t point to a week.</Message>;

  const ctx = await getReviewContext(raw);
  const title = `Week of ${formatShort(ctx.weekStart)}`;

  if (ctx.status === "no_plan") {
    return <Message title={title}>There was no plan for this week, so there&apos;s nothing to review.</Message>;
  }
  if (ctx.status === "too_early") {
    return (
      <Message title={title}>
        The review opens on Sunday at {ctx.opensAt}, once the week&apos;s riding is done.
      </Message>
    );
  }

  const { weekPlan, result, plan, review, scheduled } = ctx;
  const { stats, flags } = result;
  const sunday = addDays(ctx.weekStart, 6);
  // Once decided, show what was suggested at the time, not a recomputation.
  const suggested = review ? describeNextWeek(plan, applyDecision(plan, review.suggestion)) : ctx.headline;
  const planLabel = weekPlan.plan_week
    ? weekPlan.plan_week.plan_week === 0
      ? `Minimum week (plan wk ${weekPlan.pointer} on hold)`
      : `Plan wk ${weekPlan.plan_week.plan_week} · ${TYPE_LABEL[weekPlan.plan_week.type]}`
    : `Rest week (plan wk ${weekPlan.pointer} on hold)`;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{planLabel}</p>
      </header>

      <Card>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Suggestion</p>
        <p className="mt-1 text-xl font-semibold">{suggested}</p>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {(review?.reasons ?? result.reasons).map((r) => (
            <li
              key={`${r.code}-${r.text}`}
              className={r.code.startsWith("excluded") ? "text-zinc-500 dark:text-zinc-400" : ""}
            >
              {r.code.startsWith("excluded") ? "· " : "• "}
              {r.text}
            </li>
          ))}
        </ul>
      </Card>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Rides" value={`${stats.sessionsDone}/${stats.sessionsPlanned}`} sub={`${stats.completionPct}%`} flagged={flags.sessions} />
        <Stat label="Short nights" value={String(stats.shortSleepNights)} sub={`flag at ${ctx.settings.sleep_flag_nights}`} flagged={flags.sleep} />
        <Stat label="Off-plan days" value={String(stats.offPlanDays)} sub={`flag at ${ctx.settings.diet_flag_days}`} flagged={flags.diet} />
        {stats.corePlanned > 0 && <Stat label="Core" value={`${stats.coreDone}/${stats.corePlanned}`} sub="not counted" />}
        {stats.illnessDays > 0 && <Stat label="Ill days" value={String(stats.illnessDays)} sub="in a row" />}
      </dl>

      {review ? (
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {review.decision === "accepted" ? "Accepted" : "Overridden"} ·{" "}
            {new Date(review.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </p>
          <p className="mt-1 font-semibold">
            {scheduled
              ? describeNextWeek(plan, {
                  pointer: scheduled.pointer,
                  planWeek: scheduled.plan_week?.plan_week ?? null,
                  variant: scheduled.variant,
                  pendingAfter: scheduled.pending_after,
                  blockComplete: false,
                })
              : "Next week scheduled"}
          </p>
          {review.decision_note && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">“{review.decision_note}”</p>}
          {scheduled && (
            <p className="mt-2 text-sm text-zinc-500">Starts {formatShort(scheduled.week_start)}. This week&apos;s logs are now locked.</p>
          )}
          <Link href="/today" className="mt-3 inline-block text-sm font-medium underline">
            Go to Today
          </Link>
        </Card>
      ) : (
        <>
          {canLogDate(sunday, ctx.today) && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Something missing?{" "}
              <Link href={`/today?date=${sunday}`} className="font-medium underline">
                Finish the week&apos;s logs
              </Link>{" "}
              first. Deciding locks them.
            </p>
          )}
          <ReviewForm weekStart={ctx.weekStart} plan={plan} suggestion={result.suggestion} headline={ctx.headline} />
        </>
      )}
    </div>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{children}</p>
      <Link href="/today" className="text-sm font-medium underline">
        Go to Today
      </Link>
    </div>
  );
}
