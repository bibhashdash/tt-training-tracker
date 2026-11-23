import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/allowed-email";
import { supabaseKey, supabaseUrl } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Refreshes the Supabase session cookie on every request and does an optimistic
 * redirect to /login when there is no session. Pages still check the user
 * themselves (lib/auth.ts); this is only the fast path.
 */
export async function proxy(request: NextRequest) {
  // If Supabase falls back to the Site URL (redirect address not in its allow
  // list), the OAuth ?code= lands on "/" and would be lost. Send it on to the
  // route that exchanges it.
  const code = request.nextUrl.searchParams.get("code");
  if (code && request.nextUrl.pathname !== "/auth/confirm") {
    const confirm = new URL("/auth/confirm", request.url);
    confirm.searchParams.set("code", code);
    return NextResponse.redirect(confirm);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // getClaims() verifies the JWT; don't run code between client creation and this call.
  const { data } = await supabase.auth.getClaims();
  // A session for any account other than ALLOWED_EMAIL counts as signed out here,
  // so /login stays reachable and shows the "not allowed" message.
  const signedIn = Boolean(data?.claims?.sub) && isAllowedEmail(data?.claims?.email);
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!signedIn && !isPublic) {
    return redirectKeepingCookies(request, response, "/login");
  }
  if (signedIn && pathname === "/login") {
    return redirectKeepingCookies(request, response, "/today");
  }
  return response;
}

function redirectKeepingCookies(request: NextRequest, from: NextResponse, path: string) {
  const redirect = NextResponse.redirect(new URL(path, request.url));
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  // Static assets, icons and the web app manifest must load without a session.
  matcher: ["/((?!_next/static|_next/image|icons/|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
