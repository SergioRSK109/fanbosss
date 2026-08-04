import { describe, expect, it } from "vitest";
import { parseTheme } from "@/lib/theme";

describe("parseTheme", () => {
  it("accepts a valid light/dark value verbatim", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("treats an explicit 'system' value as system", () => {
    expect(parseTheme("system")).toBe("system");
  });

  it("falls back to system for a missing cookie", () => {
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme(null)).toBe("system");
  });

  it("falls back to system for any malformed/tampered value", () => {
    expect(parseTheme("")).toBe("system");
    expect(parseTheme("LIGHT")).toBe("system");
    expect(parseTheme("dark; evil=1")).toBe("system");
    expect(parseTheme("blue")).toBe("system");
  });
});
