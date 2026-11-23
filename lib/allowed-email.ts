/**
 * Single-user app: only ALLOWED_EMAIL may use it. Fails closed when unset.
 * Comparison ignores case and surrounding whitespace. No server-only import
 * so the proxy can use it too.
 */
export function isAllowedEmail(email: unknown, allowed = process.env.ALLOWED_EMAIL): boolean {
  if (typeof email !== "string" || !allowed?.trim()) return false;
  return email.trim().toLowerCase() === allowed.trim().toLowerCase();
}
