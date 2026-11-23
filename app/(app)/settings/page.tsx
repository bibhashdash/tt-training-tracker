import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { signOut } from "@/app/login/actions";
import { btn } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { loadSettings } from "@/lib/queries";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Link
        href="/settings/blocks"
        className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <span>
          <span className="block font-medium">Training blocks</span>
          <span className="block text-sm text-zinc-600 dark:text-zinc-400">View, edit and add blocks of plan weeks</span>
        </span>
        <ChevronRight aria-hidden size={20} className="text-zinc-400" />
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />}>
        <LoadedSettings />
      </Suspense>
      <form action={signOut}>
        <button type="submit" className={`${btn.base} ${btn.secondary} w-full`}>
          Sign out
        </button>
      </form>
    </div>
  );
}

async function LoadedSettings() {
  await connection();
  const { supabase } = await requireUser();
  const settings = await loadSettings(supabase);
  return <SettingsForm settings={settings} />;
}
