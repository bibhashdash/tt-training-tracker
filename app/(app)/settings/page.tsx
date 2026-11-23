import type { Metadata } from "next";
import { signOut } from "@/app/login/actions";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Thresholds become editable in milestone 2.</p>
      </div>
      <form action={signOut}>
        <button
          type="submit"
          className="h-12 w-full rounded-lg border border-zinc-300 font-medium dark:border-zinc-700"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
