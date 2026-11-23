"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = {
  step: "email" | "code";
  email: string;
  error?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Two-step email sign-in.
 *  intent=send:    email a magic link plus a 6-digit code.
 *  intent=verify:  sign in with the code (works inside an installed PWA, where links open in the browser).
 *  intent=restart: back to the email step.
 */
export async function login(prev: LoginState, formData: FormData): Promise<LoginState> {
  const intent = formData.get("intent");

  if (intent === "restart") return { step: "email", email: prev.email };

  if (intent === "verify") {
    const token = String(formData.get("code") ?? "").replace(/\s/g, "");
    if (!/^\d{6,10}$/.test(token)) return { ...prev, error: "Enter the code from the email." };
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ email: prev.email, token, type: "email" });
    if (error) return { ...prev, error: "That code didn't work. Check it, or send a new one." };
    redirect("/today");
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { step: "email", email, error: "Enter a valid email address." };

  // Single-user app: only the configured address may sign in. Fails closed if unset.
  const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!allowed) return { step: "email", email, error: "ALLOWED_EMAIL isn't set on the server." };
  if (email !== allowed) return { step: "email", email, error: "That email can't sign in here." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/confirm?next=/today` },
  });
  if (error) return { step: "email", email, error: error.message };
  return { step: "code", email };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
