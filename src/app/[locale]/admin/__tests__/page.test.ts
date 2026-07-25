import { describe, expect, it, vi, beforeEach } from "vitest";

// /admin must 404 for any non-admin visitor -- logged out or logged in
// but not admin -- never a redirect (a redirect to /login would itself
// reveal the page exists and is gated). Mirrors the [handle] page test's
// approach: mock notFound() to throw, assert it's what actually stops
// execution before any admin-only data is ever fetched.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/components/admin/GestionAdminsManager", () => ({
  GestionAdminsManager: () => null,
}));

vi.mock("@/components/admin/RemboursementsManuelsManager", () => ({
  RemboursementsManuelsManager: () => null,
}));

import {
  createSupabaseServerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

function buildAuthedClient(user: { id: string } | null, estAdmin: boolean) {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: user ? { est_admin: estAdmin } : null }),
        }),
      }),
    }),
  };
}

// Every chain method (select/gte/eq/order) returns a new instance of the
// same thenable, resolving to `{ data, error: null }` regardless of how
// deep the real page's query chain goes -- avoids hand-modeling each of
// page.tsx's three different chain shapes off the same `.from()` call.
function buildQueryChain(): PromiseLike<{ data: unknown[]; error: null }> & {
  select: () => ReturnType<typeof buildQueryChain>;
  gte: () => ReturnType<typeof buildQueryChain>;
  eq: () => ReturnType<typeof buildQueryChain>;
  order: () => ReturnType<typeof buildQueryChain>;
} {
  const promise = Promise.resolve({ data: [], error: null });
  return Object.assign(promise, {
    select: buildQueryChain,
    gte: buildQueryChain,
    eq: buildQueryChain,
    order: buildQueryChain,
  });
}

function buildServiceClient(serviceQuerySpy: (table: string) => void) {
  return {
    from: (table: string) => {
      serviceQuerySpy(table);
      return { select: () => buildQueryChain() };
    },
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: [] } }),
      },
    },
  };
}

describe("GET /[locale]/admin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("404s an unauthenticated visitor before ever touching admin-only data", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildAuthedClient(null, false) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );
    const serviceQuerySpy = vi.fn();
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      buildServiceClient(serviceQuerySpy) as unknown as ReturnType<
        typeof createSupabaseServiceRoleClient
      >,
    );

    const { default: AdminPage } = await import("@/app/[locale]/admin/page");
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(serviceQuerySpy).not.toHaveBeenCalled();
  });

  it("404s a logged-in visitor who isn't admin -- not a redirect", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildAuthedClient({ id: "u1" }, false) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );
    const serviceQuerySpy = vi.fn();
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      buildServiceClient(serviceQuerySpy) as unknown as ReturnType<
        typeof createSupabaseServiceRoleClient
      >,
    );

    const { default: AdminPage } = await import("@/app/[locale]/admin/page");
    await expect(AdminPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(serviceQuerySpy).not.toHaveBeenCalled();
  });

  it("renders for a genuine admin without calling notFound()", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildAuthedClient({ id: "admin-1" }, true) as unknown as Awaited<
        ReturnType<typeof createSupabaseServerClient>
      >,
    );
    const serviceQuerySpy = vi.fn();
    vi.mocked(createSupabaseServiceRoleClient).mockReturnValue(
      buildServiceClient(serviceQuerySpy) as unknown as ReturnType<
        typeof createSupabaseServiceRoleClient
      >,
    );

    const { default: AdminPage } = await import("@/app/[locale]/admin/page");
    const result = await AdminPage();

    expect(result).toBeTruthy();
    expect(serviceQuerySpy).toHaveBeenCalled();
  });
});
