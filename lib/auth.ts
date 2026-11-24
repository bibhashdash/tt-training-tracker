import "server-only";
import { redirect } from "next/navigation";
import { isAllowedEmail } from "@/lib/allowed-email";
import { createClient } from "@/lib/supabase/server";

export { isAllowedEmail };

/**
 * Returns a Supabase client and the verified user id, or redirects to /login.
 * Call this from every page and server action that touches user data.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) redirect("/login");
  if (!isAllowedEmail(claims.email)) {
    await supabase.auth.signOut();
    redirect("/login?error=not_allowed");
  }
  return { supabase, userId: claims.sub };
}

/**
 * The signed-in, allowed user's id, or null. Never redirects: for public pages
 * that only want to adapt (e.g. where a Back link should go).
 */
export async function getAllowedUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  return claims?.sub && isAllowedEmail(claims.email) ? claims.sub : null;
}

/** Only redirect to same-site paths, never to another origin. */
export function safeNext(next: string | null | undefined, fallback = "/today"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
