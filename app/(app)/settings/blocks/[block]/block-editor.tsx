"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { saveBlock } from "@/app/actions/blocks";
import { btn, Card, ErrorText, Segmented, Toggle } from "@/components/ui";
import {
  BLOCK_WEEK_TYPES,
  defaultSession,
  rideMinutes,
  validateBlock,
  type BlockDraft,
  type Issue,
  type SessionDraft,
  type WeekDraft,
} from "@/lib/blocks";
import type { BlockContext } from "@/lib/blocks-server";
import { weekdayShort, type Weekday } from "@/lib/dates";

const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const TYPE_LABEL = { habits: "Habits", build: "Build", easy: "Easy" } as const;
const input = "h-11 w-full min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

export function BlockEditor({ initial, ctx, cutoff }: { initial: BlockDraft; ctx: BlockContext; cutoff: string }) {
  const [weeks, setWeeks] = useState<WeekDraft[]>(initial.weeks);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const draft: BlockDraft = { block: initial.block, weeks };
  const { errors, warnings } = useMemo(
    () => validateBlock({ block: initial.block, weeks }, { cutoff, ...ctx }),
    [weeks, cutoff, ctx, initial.block],
  );

  const update = (planWeek: number, fn: (w: WeekDraft) => WeekDraft) => {
    setDirty(true);
    setStatus(null);
    setWeeks((ws) => ws.map((w) => (w.plan_week === planWeek ? fn(w) : w)));
  };

  const addWeek = () => {
    setDirty(true);
    setWeeks((ws) => {
      const prev = ws.at(-1);
      const next: WeekDraft = prev
        ? { ...prev, plan_week: prev.plan_week + 1, used: false, sessions: prev.sessions.map((s) => ({ ...s })) }
        : { plan_week: ctx.expectedFirstWeek, type: "build", notes: null, used: false, sessions: [] };
      return [...ws, next];
    });
  };

  const removeLastWeek = () => {
    setDirty(true);
    setWeeks((ws) => ws.slice(0, -1));
  };

  const save = () =>
    startTransition(async () => {
      const r = await saveBlock(draft);
      if (r.ok) {
        setDirty(false);
        setStatus({ kind: "saved", text: "Saved" });
      } else {
        setStatus({ kind: "error", text: r.error });
      }
    });

  const issuesFor = (pw: number) => ({
    errors: errors.filter((e) => e.planWeek === pw),
    warnings: warnings.filter((e) => e.planWeek === pw),
  });
  const blockErrors = errors.filter((e) => e.planWeek === 0);
  const last = weeks.at(-1);

  return (
    <div className="flex flex-col gap-4">
      {blockErrors.map((e) => (
        <ErrorText key={e.message}>{e.message}</ErrorText>
      ))}

      {weeks.map((w, i) => (
        <WeekCard
          key={w.plan_week}
          week={w}
          index={i + 1}
          issues={issuesFor(w.plan_week)}
          onChange={(fn) => update(w.plan_week, fn)}
        />
      ))}

      {ctx.isLast && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={addWeek} disabled={weeks.length >= 12} className={`${btn.base} ${btn.secondary}`}>
            <Plus aria-hidden size={16} className="mr-1" /> Add a week
          </button>
          <button
            type="button"
            onClick={removeLastWeek}
            disabled={!last || last.used || weeks.length <= 1}
            className={`${btn.base} ${btn.secondary}`}
          >
            <Trash2 aria-hidden size={16} className="mr-1" /> Remove last week
          </button>
        </div>
      )}

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-10 flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white/95 p-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <p aria-live="polite" className="text-sm">
          {status?.kind === "error" ? (
            <span className="text-red-600 dark:text-red-400">{status.text}</span>
          ) : errors.length > 0 ? (
            <span className="text-red-600 dark:text-red-400">
              {errors.length} {errors.length === 1 ? "problem" : "problems"} to fix before saving
            </span>
          ) : status?.kind === "saved" && !dirty ? (
            <span className="text-emerald-700 dark:text-emerald-400">Saved ✓</span>
          ) : warnings.length > 0 ? (
            <span className="text-amber-700 dark:text-amber-400">
              {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}. You can still save.
            </span>
          ) : (
            <span className="text-zinc-500">{dirty ? "Unsaved changes" : "No changes"}</span>
          )}
        </p>
        <button type="button" onClick={save} disabled={pending || !dirty || errors.length > 0} className={`${btn.base} ${btn.primary}`}>
          {pending ? "Saving…" : "Save block"}
        </button>
      </div>
    </div>
  );
}

function WeekCard({
  week: w,
  index,
  issues,
  onChange,
}: {
  week: WeekDraft;
  index: number;
  issues: { errors: Issue[]; warnings: Issue[] };
  onChange: (fn: (w: WeekDraft) => WeekDraft) => void;
}) {
  const [addDay, setAddDay] = useState<Weekday>(2);
  const [addKind, setAddKind] = useState<"ride" | "core">("ride");
  const taken = w.sessions.some((s) => s.weekday === addDay && s.kind === addKind);

  const setSession = (i: number, s: SessionDraft | null) =>
    onChange((wk) => ({
      ...wk,
      sessions: (s === null ? wk.sessions.filter((_, j) => j !== i) : wk.sessions.map((x, j) => (j === i ? s : x))).sort(
        (a, b) => a.weekday - b.weekday || (a.kind === b.kind ? 0 : a.kind === "ride" ? -1 : 1),
      ),
    }));

  return (
    <Card className={w.used ? "opacity-75" : ""}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-semibold">
          Week {index} <span className="font-normal text-zinc-500">· plan wk {w.plan_week}</span>
        </p>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">{rideMinutes(w)} min</span>
      </div>

      {w.used ? (
        <>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            {TYPE_LABEL[w.type]} · scheduled, read-only
          </p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {w.sessions.map((s) => (
              <li key={`${s.weekday}-${s.kind}`}>{summary(s)}</li>
            ))}
          </ul>
        </>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <Segmented
            label="Week type"
            value={w.type}
            options={BLOCK_WEEK_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
            onChange={(type) => onChange((wk) => ({ ...wk, type }))}
          />
          <input
            aria-label="Week notes"
            placeholder="Notes for the week (optional)"
            maxLength={300}
            value={w.notes ?? ""}
            onChange={(e) => onChange((wk) => ({ ...wk, notes: e.target.value }))}
            className={input}
          />

          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {w.sessions.map((s, i) => (
              <SessionRow key={`${s.weekday}-${s.kind}`} session={s} onChange={(next) => setSession(i, next)} />
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <select
              aria-label="Day"
              value={addDay}
              onChange={(e) => setAddDay(Number(e.target.value) as Weekday)}
              className={`${input} w-24`}
            >
              {WEEKDAYS.map((d) => (
                <option key={d} value={d}>
                  {weekdayShort(d)}
                </option>
              ))}
            </select>
            <select
              aria-label="Kind"
              value={addKind}
              onChange={(e) => setAddKind(e.target.value as "ride" | "core")}
              className={`${input} w-24`}
            >
              <option value="ride">Ride</option>
              <option value="core">Core</option>
            </select>
            <button
              type="button"
              disabled={taken}
              onClick={() => onChange((wk) => ({ ...wk, sessions: [...wk.sessions, defaultSession(addDay, addKind)] }))}
              className={`${btn.base} ${btn.secondary} h-11 flex-1`}
            >
              {taken ? "Already added" : "Add"}
            </button>
          </div>
        </div>
      )}

      {(issues.errors.length > 0 || issues.warnings.length > 0) && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {issues.errors.map((e) => (
            <li key={e.message} className="text-red-600 dark:text-red-400">
              {e.message}
            </li>
          ))}
          {issues.warnings.map((e) => (
            <li key={e.message} className="text-amber-700 dark:text-amber-400">
              {e.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function summary(s: SessionDraft): string {
  return `${weekdayShort(s.weekday)} · ${s.kind === "core" ? "Core" : "Ride"} ${s.target_minutes} min${s.zone ? ` · ${s.zone}` : ""}${s.is_key ? " · key" : ""}`;
}

/** One session: tap to expand and edit. */
function SessionRow({ session: s, onChange }: { session: SessionDraft; onChange: (s: SessionDraft | null) => void }) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof SessionDraft>(k: K, v: SessionDraft[K]) => onChange({ ...s, [k]: v });
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v.replace(/\D/g, "")))));

  return (
    <li className="py-2">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 w-full items-center justify-between gap-2 text-left">
        <span className="text-sm">
          <span className="font-medium">{summary(s)}</span>
          {s.description && <span className="block text-xs text-zinc-500">{s.description}</span>}
        </span>
        <span aria-hidden className="text-zinc-400">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Minutes</span>
              <input inputMode="numeric" value={s.target_minutes} onChange={(e) => set("target_minutes", num(e.target.value) ?? 0)} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Zone</span>
              <input list="zones" value={s.zone ?? ""} maxLength={12} onChange={(e) => set("zone", e.target.value || null)} className={input} />
            </label>
          </div>
          <datalist id="zones">
            {["Z1", "Z1-2", "Z2", "Z3", "Z4", "Z5"].map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Description</span>
            <input value={s.description ?? ""} maxLength={200} placeholder="e.g. 2 x 10 min Z3, rest easy" onChange={(e) => set("description", e.target.value || null)} className={input} />
          </label>
          {s.kind === "ride" && (
            <Toggle label="Key session" hint="Must finish before the cutoff" checked={s.is_key} onChange={(v) => set("is_key", v)} />
          )}

          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Slots (ceilings, not targets)</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Primary</span>
              <input type="time" value={s.primary_slot} onChange={(e) => set("primary_slot", e.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Ceiling (min)</span>
              <input inputMode="numeric" placeholder="no limit" value={s.max_minutes ?? ""} onChange={(e) => set("max_minutes", num(e.target.value))} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Backup</span>
              <input type="time" value={s.backup_slot ?? ""} onChange={(e) => set("backup_slot", e.target.value || null)} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-500">Backup ceiling</span>
              <input inputMode="numeric" placeholder="same" value={s.backup_max_minutes ?? ""} onChange={(e) => set("backup_max_minutes", num(e.target.value))} className={input} />
            </label>
          </div>

          <button type="button" onClick={() => onChange(null)} className={`${btn.base} h-10 self-start px-0 text-red-600 dark:text-red-400`}>
            <Trash2 aria-hidden size={16} className="mr-1" /> Remove session
          </button>
        </div>
      )}
    </li>
  );
}
