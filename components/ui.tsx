// Small shared UI primitives. No "use client" so server and client components can both use them.
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      {children}
    </div>
  );
}

export const btn = {
  base: "inline-flex h-12 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors disabled:opacity-50",
  primary: "bg-zinc-900 text-white active:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:active:bg-zinc-300",
  secondary:
    "border border-zinc-300 bg-white text-zinc-900 active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:active:bg-zinc-800",
  ghost: "text-zinc-600 underline-offset-2 active:underline dark:text-zinc-400",
} as const;

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  columns,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  columns?: number;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800"
      style={{ gridTemplateColumns: `repeat(${columns ?? options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`h-11 rounded-md text-sm font-medium ${
              selected
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-600 dark:text-white"
                : "text-zinc-600 dark:text-zinc-300"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-12 w-full items-center justify-between gap-3 py-2 text-left"
    >
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </span>
      <span
        aria-hidden
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
          checked ? "bg-emerald-600" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}
