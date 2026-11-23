import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, safeNext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth return route. Supabase redirects here with ?code= after Google sign-in;
 * we exchange it for a session, then refuse any account other than ALLOWED_EMAIL.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (!code) return to("/login?error=link");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return to("/login?error=link");

  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    return to("/login?error=not_allowed");
  }
  return to(next);
}
