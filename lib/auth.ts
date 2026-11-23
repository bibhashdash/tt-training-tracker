import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Returns a Supabase client and the verified user id, or redirects to /login.
 * Call this from every page and server action that touches user data.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) redirect("/login");
  return { supabase, userId };
}

/** Only redirect to same-site paths, never to another origin. */
export function safeNext(next: string | null | undefined, fallback = "/today"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
