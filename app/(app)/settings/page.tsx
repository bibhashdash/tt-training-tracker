import type { Metadata } from "next";
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
