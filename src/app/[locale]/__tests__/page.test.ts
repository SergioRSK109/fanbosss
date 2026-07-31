import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Same root cause as login/signup's redirect tests: Home used to show
// "Créer un compte"/"Se connecter" unconditionally, which is what made
// clicking the logo while already logged in look like a logout (the
// visitor lands on a page that doesn't acknowledge their session, then
// naturally clicks "Se connecter" and sees a real password form).
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

// The real next-intl navigation module drags in a next/navigation
// resolution that doesn't work under plain Vitest -- Home is only being
// called directly here (never actually rendered to a DOM), so the JSX
// element tree already carries the real `href` props regardless of what
// this mock's Link implementation does.
vi.mock("@/i18n/navigation", () => ({
  Link: (props: { href: string; children?: ReactNode }) => props,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    const strings: Record<string, string> = {
      title: "FanBoss",
      tagline: "tagline",
      signup: "Créer un compte",
      login: "Se connecter",
      dashboard: "Accéder à mon espace",
    };
    return (key: string) => strings[key] ?? key;
  }),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";

function buildSupabaseMock(user: { id: string } | null) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
  };
}

// Links in this app are locale-aware React elements, not real <a> tags in
// a DOM -- this project has no @testing-library/react dependency, so
// walk the returned element tree directly (consistent with how other
// page tests here just call the function and inspect what it does,
// rather than rendering to a DOM) to find every href actually present.
function collectHrefs(node: ReactNode, hrefs: string[] = []): string[] {
  if (node == null || typeof node === "boolean") {
    return hrefs;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectHrefs(child, hrefs));
    return hrefs;
  }
  if (typeof node === "object" && "props" in (node as ReactElement)) {
    const element = node as ReactElement<{ href?: string; children?: ReactNode }>;
    if (typeof element.props?.href === "string") {
      hrefs.push(element.props.href);
    }
    collectHrefs(element.props?.children, hrefs);
  }
  return hrefs;
}

describe("GET /[locale] (Home)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a /home CTA (not signup/login) for an already-authenticated visitor", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock({ id: "user-1" }) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: Home } = await import("@/app/[locale]/page");
    const element = await Home({ params: Promise.resolve({ locale: "fr" }) });
    const hrefs = collectHrefs(element);

    expect(hrefs).toContain("/home");
    expect(hrefs).not.toContain("/signup");
    expect(hrefs).not.toContain("/login");
  });

  it("shows signup/login CTAs (not /home) for a logged-out visitor", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildSupabaseMock(null) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );

    const { default: Home } = await import("@/app/[locale]/page");
    const element = await Home({ params: Promise.resolve({ locale: "fr" }) });
    const hrefs = collectHrefs(element);

    expect(hrefs).toContain("/signup");
    expect(hrefs).toContain("/login");
    expect(hrefs).not.toContain("/home");
  });
});
