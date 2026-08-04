import { describe, expect, it } from "vitest";
import { THEME_COOKIE_MAX_AGE_SECONDS, THEME_COOKIE_NAME } from "@/lib/theme";

function buildRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/theme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/theme", () => {
  it("sets the theme cookie to a valid requested value, no auth required", async () => {
    const { POST } = await import("@/app/api/theme/route");
    const response = await POST(buildRequest({ theme: "dark" }) as never);
    const body = await response.json();

    expect(body).toEqual({ theme: "dark" });
    const cookie = response.cookies.get(THEME_COOKIE_NAME);
    expect(cookie?.value).toBe("dark");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(THEME_COOKIE_MAX_AGE_SECONDS);
  });

  it("falls back to system for an invalid theme value, never trusting the client's raw input", async () => {
    const { POST } = await import("@/app/api/theme/route");
    const response = await POST(buildRequest({ theme: "purple" }) as never);
    const body = await response.json();

    expect(body).toEqual({ theme: "system" });
    expect(response.cookies.get(THEME_COOKIE_NAME)?.value).toBe("system");
  });

  it("falls back to system for a missing/malformed request body", async () => {
    const { POST } = await import("@/app/api/theme/route");
    const request = new Request("http://localhost/api/theme", { method: "POST" });
    const response = await POST(request as never);
    const body = await response.json();

    expect(body).toEqual({ theme: "system" });
  });
});
