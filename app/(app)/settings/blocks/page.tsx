import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { createNextBlock } from "@/app/actions/blocks";
import { btn, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { rideMinutes } from "@/lib/blocks";
import { loadBlocks } from "@/lib/blocks-server";

export const metadata: Metadata = { title: "Training blocks" };

const ERRORS: Record<string, string> = {
  pct: "Pick an increase between 0 and 30%.",
  none: "There's no block to copy from.",
  save: "Couldn't create the block. Try again.",
};

export default function BlocksPage({ searchParams }: PageProps<"/settings/blocks">) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center gap-2">
        <Link href="/settings" aria-label="Back to settings" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg">
          <ChevronLeft aria-hidden size={22} />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Training blocks</h1>
      </header>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />}>
        <Blocks searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Blocks({ searchParams }: Pick<PageProps<"/settings/blocks">, "searchParams">) {
  await connection();
  const { error } = await searchParams;
  const { supabase } = await requireUser();
  const blocks = await loadBlocks(supabase);
  const last = blocks.at(-1);

  return (
    <>
      {typeof error === "string" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {ERRORS[error] ?? "Something went wrong."}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {blocks.map((b) => {
          const first = b.weeks[0]?.plan_week;
          const lastWeek = b.weeks.at(-1)?.plan_week;
          const scheduled = b.weeks.filter((w) => w.used).length;
          const minutes = b.weeks.map(rideMinutes);
          return (
            <li key={b.block}>
              <Link
                href={`/settings/blocks/${b.block}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span>
                  <span className="block font-semibold">Block {b.block}</span>
                  <span className="block text-sm text-zinc-600 dark:text-zinc-400">
                    Plan weeks {first}–{lastWeek} · {Math.min(...minutes)}–{Math.max(...minutes)} min/week
                  </span>
                  <span className="block text-xs text-zinc-500">
                    {b.weeks.map((w) => w.type[0].toUpperCase()).join(" ")}
                    {scheduled > 0 && ` · ${scheduled} scheduled`}
                  </span>
                </span>
                <ChevronRight aria-hidden size={20} className="shrink-0 text-zinc-400" />
              </Link>
            </li>
          );
        })}
      </ul>

      {last && (
        <Card>
          <form action={createNextBlock} className="flex flex-col gap-3">
            <div>
              <p className="font-semibold">Add Block {last.block + 1}</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Copies Block {last.block} and raises the rides in build weeks. Habits and easy weeks, core and slot
                ceilings stay the same. You can edit everything afterwards.
              </p>
            </div>
            <label className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Build-week increase</span>
              <span className="flex items-center gap-2">
                <input
                  name="pct"
                  type="number"
                  min={0}
                  max={30}
                  step={1}
                  defaultValue={10}
                  className="h-11 w-20 rounded-lg border border-zinc-300 bg-transparent px-3 text-right text-base dark:border-zinc-700"
                />
                <span className="text-sm">%</span>
              </span>
            </label>
            <button type="submit" className={`${btn.base} ${btn.primary}`}>
              Copy Block {last.block} and progress
            </button>
          </form>
        </Card>
      )}
    </>
  );
}
