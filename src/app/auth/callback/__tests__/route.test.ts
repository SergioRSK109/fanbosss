import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/app/auth/callback/route";

// /auth/callback's `redirect` query param is attacker-visible (it's part
// of the emailed password-reset link, now built from user input at
// mot-de-passe-oublie/MotDePasseOublieForm.tsx) -- this asserts it can
// never send a successfully-authenticated visitor off-site.
describe("safeRedirectPath", () => {
  it("allows a plain relative path", () => {
    expect(safeRedirectPath("/reinitialiser-mot-de-passe")).toBe(
      "/reinitialiser-mot-de-passe",
    );
  });

  it("defaults to /dashboard when missing", () => {
    expect(safeRedirectPath(null)).toBe("/dashboard");
  });

  it("rejects an absolute URL", () => {
    expect(safeRedirectPath("https://evil.example/phishing")).toBe("/dashboard");
  });

  it("rejects a protocol-relative URL", () => {
    expect(safeRedirectPath("//evil.example")).toBe("/dashboard");
  });

  it("rejects a value that doesn't start with a slash", () => {
    expect(safeRedirectPath("dashboard")).toBe("/dashboard");
  });
});
