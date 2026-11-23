"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth";
import { parseSettings } from "@/lib/validation";

export type SettingsState = { status: "idle" | "saved" | "error"; error?: string };

export async function saveSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const parsed = parseSettings(Object.fromEntries(formData));
  if (!parsed.ok) return { status: "error", error: parsed.error };

  const { supabase, userId } = await requireUser();
  const { error } = await supabase.from("settings").update(parsed.value).eq("user_id", userId);
  if (error) return { status: "error", error: error.message };

  refresh();
  return { status: "saved" };
}
