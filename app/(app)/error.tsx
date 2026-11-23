"use client";

import { btn } from "@/components/ui";

/** Shown when a screen fails to load (e.g. no signal). */
export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Couldn&apos;t load this</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Probably a dropped connection. Nothing you logged has been lost.
      </p>
      <button type="button" onClick={() => retry()} className={`${btn.base} ${btn.primary}`}>
        Try again
      </button>
    </div>
  );
}
