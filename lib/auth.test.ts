import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const { isAllowedEmail, safeNext } = await import("./auth");

describe("isAllowedEmail", () => {
  it("matches ignoring case and whitespace", () => {
    expect(isAllowedEmail("Rider@Example.com ", "rider@example.com")).toBe(true);
  });

  it("refuses other addresses", () => {
    expect(isAllowedEmail("someone@example.com", "rider@example.com")).toBe(false);
  });

  it("fails closed when ALLOWED_EMAIL is unset or the email is missing", () => {
    expect(isAllowedEmail("rider@example.com", "")).toBe(false);
    expect(isAllowedEmail("rider@example.com", undefined)).toBe(false);
    expect(isAllowedEmail(undefined, "rider@example.com")).toBe(false);
  });
});

describe("safeNext", () => {
  it("keeps same-site paths and rejects other origins", () => {
    expect(safeNext("/log")).toBe("/log");
    expect(safeNext("//evil.com")).toBe("/today");
    expect(safeNext("/\\evil.com")).toBe("/today");
    expect(safeNext("https://evil.com")).toBe("/today");
    expect(safeNext(null)).toBe("/today");
  });
});
