export function Placeholder({ title, milestone }: { title: string; milestone: number }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Coming in milestone {milestone}.</p>
    </div>
  );
}
