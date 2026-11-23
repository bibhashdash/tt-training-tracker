"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { parseBlockDraft, progressBlock, validateBlock, type BlockDraft } from "@/lib/blocks";
import { blockContext, loadBlocks } from "@/lib/blocks-server";
import { hhmm } from "@/lib/dates";
import { loadSettings } from "@/lib/queries";

export type BlockActionResult = { ok: true } | { ok: false; error: string };

const toRpcWeeks = (draft: BlockDraft) =>
  draft.weeks.map((w) => ({
    plan_week: w.plan_week,
    type: w.type,
    notes: w.notes,
    sessions: w.sessions,
  }));

/** "Copy and progress": a new block after the last one, build-week rides raised by `pct`%. */
export async function createNextBlock(formData: FormData): Promise<void> {
  const pct = Number(formData.get("pct"));
  if (!Number.isInteger(pct) || pct < 0 || pct > 30) redirect("/settings/blocks?error=pct");

  const { supabase } = await requireUser();
  const blocks = await loadBlocks(supabase);
  const last = blocks.at(-1);
  if (!last) redirect("/settings/blocks?error=none");

  const next = progressBlock(last, blockContext(blocks, last.block + 1).expectedFirstWeek, pct);
  const { error } = await supabase.rpc("save_block", { p_block: next.block, p_weeks: toRpcWeeks(next) });
  if (error) redirect(`/settings/blocks?error=save`);
  redirect(`/settings/blocks/${next.block}`);
}

/** Saves the whole block. Scheduled weeks are kept exactly as stored, whatever the client sent. */
export async function saveBlock(input: unknown): Promise<BlockActionResult> {
  const parsed = parseBlockDraft(input);
  if (!parsed.ok) return parsed;

  const { supabase } = await requireUser();
  const [blocks, settings] = await Promise.all([loadBlocks(supabase), loadSettings(supabase)]);
  const existing = blocks.find((b) => b.block === parsed.value.block);
  if (!existing) return { ok: false, error: "That block doesn't exist." };

  const stored = new Map(existing.weeks.map((w) => [w.plan_week, w]));
  const draft: BlockDraft = {
    block: parsed.value.block,
    weeks: parsed.value.weeks.map((w) => {
      const s = stored.get(w.plan_week);
      return s?.used ? s : w;
    }),
  };
  for (const w of existing.weeks) {
    if (w.used && !draft.weeks.some((d) => d.plan_week === w.plan_week)) {
      return { ok: false, error: `Plan week ${w.plan_week} has been scheduled, so it can't be removed.` };
    }
  }

  const ctx = blockContext(blocks, draft.block);
  const { errors } = validateBlock(draft, { cutoff: hhmm(settings.cutoff_time), ...ctx });
  if (errors.length > 0) {
    const e = errors[0];
    return { ok: false, error: e.planWeek ? `Week ${e.planWeek}: ${e.message}` : e.message };
  }

  const { error } = await supabase.rpc("save_block", { p_block: draft.block, p_weeks: toRpcWeeks(draft) });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** Deletes the last block, only if none of its weeks has been scheduled. */
export async function deleteLastBlock(formData: FormData): Promise<void> {
  const blockNo = Number(formData.get("block"));
  const { supabase } = await requireUser();
  const blocks = await loadBlocks(supabase);
  const last = blocks.at(-1);
  if (!last || last.block !== blockNo || last.block === 1 || last.weeks.some((w) => w.used)) {
    redirect(`/settings/blocks/${blockNo}?error=delete`);
  }
  const { error } = await supabase.rpc("save_block", { p_block: blockNo, p_weeks: [] });
  if (error) redirect(`/settings/blocks/${blockNo}?error=delete`);
  redirect("/settings/blocks");
}
