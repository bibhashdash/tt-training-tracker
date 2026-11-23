import "server-only";
import type { requireUser } from "@/lib/auth";
import { toBlockDrafts, type BlockDraft, type WeekDraft } from "@/lib/blocks";
import type { PlannedSession, PlanWeek } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

/** All blocks (template week 0 excluded), with scheduled weeks marked as used. */
export async function loadBlocks(supabase: Supabase): Promise<BlockDraft[]> {
  const [weeks, used] = await Promise.all([
    supabase
      .from("plan_weeks")
      .select(
        `id, plan_week, block, type, target_minutes, notes,
         planned_sessions ( id, weekday, kind, target_minutes, max_minutes, backup_max_minutes,
                            zone, is_key, primary_slot, backup_slot, description )`,
      )
      .gt("block", 0)
      .returns<(PlanWeek & { planned_sessions: PlannedSession[] })[]>(),
    supabase.from("week_plans").select("plan_week_id").not("plan_week_id", "is", null),
  ]);
  if (weeks.error) throw weeks.error;
  if (used.error) throw used.error;
  return toBlockDrafts(weeks.data ?? [], new Set((used.data ?? []).map((r) => r.plan_week_id as string)));
}

export interface BlockContext {
  expectedFirstWeek: number;
  fixedWeekCount: number | null;
  preceding: WeekDraft[];
  isLast: boolean;
}

/** What validateBlock needs to know about where `blockNo` sits among the others. */
export function blockContext(blocks: BlockDraft[], blockNo: number): BlockContext {
  const existing = blocks.find((b) => b.block === blockNo);
  const lastWeek = Math.max(0, ...blocks.flatMap((b) => b.weeks.map((w) => w.plan_week)));
  const lastBlock = Math.max(0, ...blocks.map((b) => b.block));
  const isLast = !existing || blockNo === lastBlock;
  return {
    expectedFirstWeek: existing?.weeks[0]?.plan_week ?? lastWeek + 1,
    fixedWeekCount: isLast ? null : (existing?.weeks.length ?? null),
    preceding: blocks.filter((b) => b.block < blockNo).flatMap((b) => b.weeks),
    isLast,
  };
}
