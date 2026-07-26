import { describe, expect, it, vi } from "vitest";

// Mocked so getCreateurProfileData can be exercised below without a real
// Supabase project -- see the "badge de fidélité" describe block. Doesn't
// affect the pure-function tests above/below, which never touch these.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  getSignedDownloadUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCreateurProfileData, resolveDisplayName, sortOffresDonFirst } from "@/lib/profil";

describe("resolveDisplayName", () => {
  it("prefers nom_affichage when set", () => {
    expect(resolveDisplayName("Sergio le Créateur", "sergio_123")).toBe(
      "Sergio le Créateur",
    );
  });

  it("falls back to pseudo when nom_affichage is null", () => {
    expect(resolveDisplayName(null, "sergio_123")).toBe("sergio_123");
  });

  it("falls back to pseudo when nom_affichage is blank", () => {
    expect(resolveDisplayName("   ", "sergio_123")).toBe("sergio_123");
  });

  it("returns null when neither is set", () => {
    expect(resolveDisplayName(null, null)).toBeNull();
  });
});

describe("sortOffresDonFirst", () => {
  it("moves don first even when it was configured after the other offres", () => {
    const offres = [
      { id: "1", type: "video" as const },
      { id: "2", type: "whatsapp" as const },
      { id: "3", type: "don" as const },
    ];

    expect(sortOffresDonFirst(offres).map((o) => o.id)).toEqual(["3", "1", "2"]);
  });

  it("keeps the relative order of every other type unchanged", () => {
    const offres = [
      { id: "1", type: "shoutout" as const },
      { id: "2", type: "video" as const },
      { id: "3", type: "evenement_live" as const },
    ];

    expect(sortOffresDonFirst(offres).map((o) => o.id)).toEqual(["1", "2", "3"]);
  });

  it("is a no-op when there is no don offre at all", () => {
    const offres = [
      { id: "1", type: "whatsapp" as const },
      { id: "2", type: "contenu_debloque" as const },
    ];

    expect(sortOffresDonFirst(offres).map((o) => o.id)).toEqual(["1", "2"]);
  });

  it("does not mutate the input array", () => {
    const offres = [
      { id: "1", type: "video" as const },
      { id: "2", type: "don" as const },
    ];
    const original = [...offres];

    sortOffresDonFirst(offres);

    expect(offres).toEqual(original);
  });
});

// Fan loyalty badge (migration 0022): proves getCreateurProfileData never
// asks badges_fidelite_publics for anything beyond the two safe columns
// it exposes, and never surfaces a montant/count in the final
// supporters/badgesFidelite output -- same "spy on the query shape"
// discipline as classementPublic.test.ts, applied here at the function
// level since getCreateurProfileData (unlike the dedicated
// getClassementPublicData) mixes several queries in one call.
describe("getCreateurProfileData -- badge de fidélité", () => {
  type Row = Record<string, unknown>;

  function chain(resolveValue: { data: unknown }) {
    const self = {
      eq: () => self,
      neq: () => self,
      in: () => self,
      order: () => self,
      single: async () => resolveValue,
      maybeSingle: async () => resolveValue,
      then: (
        onFulfilled: (value: { data: unknown }) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => Promise.resolve(resolveValue).then(onFulfilled, onRejected),
    };
    return self;
  }

  function buildClient(
    fromSpy: (table: string) => void,
    selectCalls: { table: string; columns: string }[],
    fixtures: Record<string, Row | Row[] | null>,
  ) {
    return {
      from: (table: string) => {
        fromSpy(table);
        return {
          select: (columns: string) => {
            selectCalls.push({ table, columns });
            return chain({ data: fixtures[table] ?? null });
          },
        };
      },
    };
  }

  it("selects only fan_id/createur_id + depuis from badges_fidelite_publics -- never a montant or count", async () => {
    const fromSpy = vi.fn<(table: string) => void>();
    const selectCalls: { table: string; columns: string }[] = [];

    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(fromSpy, selectCalls, {
        profils_publics: { id: "createur-1", pseudo: "sergio", nom_affichage: null },
        offres_publiques: [],
        campagnes_publiques: [],
        classement_volume: null,
        classement_reactivite: null,
        classement_progression: null,
        badges_fidelite_publics: [],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    await getCreateurProfileData("createur-1");

    const badgeSelects = selectCalls.filter((c) => c.table === "badges_fidelite_publics");
    expect(badgeSelects).toHaveLength(2);
    for (const call of badgeSelects) {
      expect(call.columns).toBe(
        call.columns.startsWith("fan_id") ? "fan_id, depuis" : "createur_id, depuis",
      );
      expect(call.columns).not.toMatch(/montant|count|prix/i);
    }
  });

  it("never surfaces a montant/count in the resulting supporters/badgesFidelite arrays", async () => {
    const fromSpy = vi.fn<(table: string) => void>();
    const selectCalls: { table: string; columns: string }[] = [];

    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(fromSpy, selectCalls, {
        profils_publics: [{ id: "fan-1", pseudo: "marie", nom_affichage: null }],
        offres_publiques: [],
        campagnes_publiques: [],
        classement_volume: null,
        classement_reactivite: null,
        classement_progression: null,
        badges_fidelite_publics: [{ fan_id: "fan-1", depuis: "2024-01-01T00:00:00Z" }],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const profile = await getCreateurProfileData("createur-1");

    expect(profile?.supporters).toEqual([
      { fanId: "fan-1", displayName: "marie", pseudo: "marie", depuis: "2024-01-01T00:00:00Z" },
    ]);
    for (const supporter of profile?.supporters ?? []) {
      expect(Object.keys(supporter).sort()).toEqual(
        ["createurId", "depuis", "displayName", "fanId", "pseudo"].filter((k) =>
          Object.prototype.hasOwnProperty.call(supporter, k),
        ),
      );
      expect(supporter).not.toHaveProperty("montant");
      expect(supporter).not.toHaveProperty("count");
    }
  });
});
