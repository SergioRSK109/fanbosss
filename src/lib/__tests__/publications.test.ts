import { describe, expect, it, vi, beforeEach } from "vitest";

// Phase C: Explorer's publications grid (getPublicationsExplorables) --
// proves the cursor-pagination query shape (composite created_at/id
// keyset, correct nextCursor computation) and that a search narrows the
// grid to créateurs matched via profils_recherchables (migration 0036)
// without ever querying publications_explorables when nothing matched,
// same "an empty .in() is ambiguous, don't even attempt it" discipline
// the old /explorer page already followed for its own type filter.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  getSignedDownloadUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  buildExplorerCursorFilter,
  getPublicationsExplorables,
  PUBLICATIONS_EXPLORABLES_PAGE_SIZE,
} from "@/lib/publications";

const PUBLICATIONS_SELECT =
  "id, auteur_id, type, contenu, image_r2_key, video_r2_key, visibilite, created_at, contenu_complet, repost_de_id, autorise_repost, likes_count, partages_count, reposts_count, viewer_a_aime, viewer_a_partage, viewer_a_reposte";

type Call = { table: string; method: string; args: unknown[] };

function makeChain(rows: unknown[], calls: Call[], table: string) {
  // A minimal stand-in for supabase-js's PostgrestFilterBuilder: every
  // filter method records the call and returns the same chainable
  // object (order matters not at all, matching the real builder), and
  // `.then` makes the whole thing awaitable, resolving to {data, error}
  // exactly like the real client does.
  const chain: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ table, method, args });
      return chain;
    };
  chain.select = record("select");
  chain.order = record("order");
  chain.limit = record("limit");
  chain.in = record("in");
  chain.or = record("or");
  chain.eq = record("eq");
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return chain;
}

function buildClient(calls: Call[], rowsByTable: Record<string, unknown[]>) {
  return {
    from: (table: string) => makeChain(rowsByTable[table] ?? [], calls, table),
  };
}

function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pub-1",
    auteur_id: "auteur-1",
    type: "createur",
    contenu: "hello",
    image_r2_key: null,
    video_r2_key: null,
    visibilite: "public",
    created_at: "2026-01-01T00:00:00.000Z",
    contenu_complet: true,
    repost_de_id: null,
    autorise_repost: "tous",
    likes_count: 0,
    partages_count: 0,
    reposts_count: 0,
    viewer_a_aime: false,
    viewer_a_partage: false,
    viewer_a_reposte: false,
    ...overrides,
  };
}

function profil(id: string) {
  return { id, pseudo: `pseudo-${id}`, nom_affichage: null, photo_r2_key: null };
}

describe("buildExplorerCursorFilter", () => {
  it("builds a composite (created_at, id) keyset OR-filter string", () => {
    const result = buildExplorerCursorFilter({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "abc-123",
    });
    expect(result).toBe(
      "created_at.lt.2026-01-01T00:00:00.000Z,and(created_at.eq.2026-01-01T00:00:00.000Z,id.lt.abc-123)",
    );
  });
});

describe("getPublicationsExplorables", () => {
  let calls: Call[];

  beforeEach(() => {
    calls = [];
  });

  function tablesQueried(table: string) {
    return calls.filter((c) => c.table === table);
  }

  it("queries publications_explorables with the right select/order/limit, no q/cursor filters, when nextCursor is null (fewer than a full page)", async () => {
    const rows = [baseRow({ id: "p1" }), baseRow({ id: "p2" })];
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(calls, {
        publications_explorables: rows,
        profils_publics: [profil("auteur-1")],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { publications, nextCursor } = await getPublicationsExplorables("", null);

    expect(tablesQueried("profils_recherchables")).toHaveLength(0);
    const explorablesCalls = tablesQueried("publications_explorables");
    expect(explorablesCalls.find((c) => c.method === "select")?.args[0]).toBe(PUBLICATIONS_SELECT);
    expect(explorablesCalls.filter((c) => c.method === "order").map((c) => c.args)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(explorablesCalls.find((c) => c.method === "limit")?.args[0]).toBe(
      PUBLICATIONS_EXPLORABLES_PAGE_SIZE,
    );
    expect(explorablesCalls.find((c) => c.method === "in")).toBeUndefined();
    expect(explorablesCalls.find((c) => c.method === "or")).toBeUndefined();

    expect(publications).toHaveLength(2);
    expect(publications[0].id).toBe("p1");
    expect(nextCursor).toBeNull();
  });

  it("computes nextCursor from the last row when a full page is returned", async () => {
    const rows = Array.from({ length: PUBLICATIONS_EXPLORABLES_PAGE_SIZE }, (_, i) =>
      baseRow({ id: `p${i}`, created_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }),
    );
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(calls, {
        publications_explorables: rows,
        profils_publics: [profil("auteur-1")],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { nextCursor } = await getPublicationsExplorables("", null);

    const last = rows[rows.length - 1];
    expect(nextCursor).toEqual({ createdAt: last.created_at, id: last.id });
  });

  it("passes an explicit cursor through as the composite keyset OR-filter", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(calls, {
        publications_explorables: [],
        profils_publics: [],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const cursor = { createdAt: "2026-02-01T00:00:00.000Z", id: "cursor-id" };
    await getPublicationsExplorables("", cursor);

    const orCall = tablesQueried("publications_explorables").find((c) => c.method === "or");
    expect(orCall?.args[0]).toBe(buildExplorerCursorFilter(cursor));
  });

  it("with a search term, resolves matching créateurs via profils_recherchables first, then filters publications_explorables by auteur_id", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(calls, {
        profils_recherchables: [{ id: "a" }, { id: "b" }],
        publications_explorables: [baseRow({ id: "p1", auteur_id: "a" })],
        profils_publics: [profil("a")],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { publications } = await getPublicationsExplorables("sergio", null);

    const searchCalls = tablesQueried("profils_recherchables");
    expect(searchCalls.find((c) => c.method === "select")?.args[0]).toBe("id");
    const searchOr = searchCalls.find((c) => c.method === "or")?.args[0] as string;
    expect(searchOr).toContain("pseudo.ilike.%sergio%");
    expect(searchOr).toContain("lien_tiktok.ilike.%sergio%");

    const inCall = tablesQueried("publications_explorables").find((c) => c.method === "in");
    expect(inCall?.args).toEqual(["auteur_id", ["a", "b"]]);
    expect(publications).toHaveLength(1);
  });

  it("never queries publications_explorables at all when the search matches no créateur", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(calls, {
        profils_recherchables: [],
        publications_explorables: [baseRow()],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const result = await getPublicationsExplorables("nobody-matches-this", null);

    expect(result).toEqual({ publications: [], nextCursor: null });
    expect(tablesQueried("publications_explorables")).toHaveLength(0);
  });
});
