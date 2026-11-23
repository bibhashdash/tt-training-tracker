import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { deleteLastBlock } from "@/app/actions/blocks";
import { btn } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { blockContext, loadBlocks } from "@/lib/blocks-server";
import { hhmm } from "@/lib/dates";
import { loadSettings } from "@/lib/queries";
import { BlockEditor } from "./block-editor";

export const metadata: Metadata = { title: "Edit block" };

export default function BlockPage({ params, searchParams }: PageProps<"/settings/blocks/[block]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />}>
      <Block params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Block({ params, searchParams }: PageProps<"/settings/blocks/[block]">) {
  await connection();
  const [{ block: raw }, { error }] = await Promise.all([params, searchParams]);
  const blockNo = Number(raw);
  const { supabase } = await requireUser();
  const [blocks, settings] = await Promise.all([loadBlocks(supabase), loadSettings(supabase)]);
  const block = blocks.find((b) => b.block === blockNo);

  const header = (
    <header className="flex items-center gap-2">
      <Link href="/settings/blocks" aria-label="Back to blocks" className="-ml-2 flex h-11 w-11 items-center justify-center rounded-lg">
        <ChevronLeft aria-hidden size={22} />
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Block {Number.isInteger(blockNo) ? blockNo : "?"}</h1>
    </header>
  );

  if (!block) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-sm text-zinc-600 dark:text-zinc-400">That block doesn&apos;t exist.</p>
      </div>
    );
  }

  const ctx = blockContext(blocks, blockNo);
  const deletable = ctx.isLast && blockNo > 1 && block.weeks.every((w) => !w.used);

  return (
    <div className="flex flex-col gap-5">
      {header}
      {error === "delete" && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          This block can&apos;t be deleted: only the last block, and only before any of its weeks is scheduled.
        </p>
      )}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Weeks already scheduled are read-only, so past weeks keep the plan they were ridden against.
        {ctx.isLast ? " This is the last block, so you can add or remove weeks at the end." : ""}
      </p>
      <BlockEditor initial={block} ctx={ctx} cutoff={hhmm(settings.cutoff_time)} />
      {deletable && (
        <details className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-red-600 dark:text-red-400">Delete Block {blockNo}…</summary>
          <form action={deleteLastBlock} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="block" value={blockNo} />
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Removes all {block.weeks.length} weeks of this block. None has been scheduled yet, so no logs are affected.
            </p>
            <button type="submit" className={`${btn.base} bg-red-600 text-white`}>
              Yes, delete Block {blockNo}
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
