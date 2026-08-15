import { describe, expect, it, vi, beforeEach } from "vitest";

// Proves the public /classement page never reads a column beyond what
// classement_volume/reactivite and profils_publics already expose
// publicly (migration 0008/0009): rank only from the classement views
// (never a count or amount), and only the public display columns from
// profils_publics (never telephone or anything monetary -- those aren't
// even in the view, but this pins down what this page's own query
// explicitly asks for too). classement_progression is deliberately
// excluded from this page (product decision) -- see classementPublic.ts.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  getSignedDownloadUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getClassementPublicData } from "@/lib/classementPublic";

type Profil = {
  id: string;
  pseudo: string | null;
  nom_affichage: string | null;
  photo_r2_key: string | null;
  createur_verifie: boolean;
};
type Row = { createur_id: string; rang: number };

function buildRankChain(rows: Row[]) {
  return {
    lte: () => ({
      order: async () => ({ data: rows, error: null }),
    }),
  };
}

function buildProfilesChain(rows: Profil[]) {
  return {
    in: async () => ({ data: rows, error: null }),
  };
}

function buildClient(
  fromSpy: (table: string) => void,
  selectCalls: { table: string; columns: string }[],
  rows: { volume: Row[]; reactivite: Row[]; profils: Profil[] },
) {
  return {
    from: (table: string) => {
      fromSpy(table);
      return {
        select: (columns: string) => {
          selectCalls.push({ table, columns });
          if (table === "profils_publics") {
            return buildProfilesChain(rows.profils);
          }
          if (table === "classement_volume") return buildRankChain(rows.volume);
          if (table === "classement_reactivite") return buildRankChain(rows.reactivite);
          throw new Error(`unexpected table queried: ${table}`);
        },
      };
    },
  };
}

describe("getClassementPublicData", () => {
  let fromSpy: ReturnType<typeof vi.fn<(table: string) => void>>;
  let selectCalls: { table: string; columns: string }[];

  beforeEach(() => {
    fromSpy = vi.fn<(table: string) => void>();
    selectCalls = [];
  });

  it("only ever queries the two public classement views and profils_publics -- never users/transactions/classement_progression", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(fromSpy, selectCalls, {
        volume: [{ createur_id: "a", rang: 1 }],
        reactivite: [],
        profils: [{ id: "a", pseudo: "sergio", nom_affichage: null, photo_r2_key: null, createur_verifie: false }],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    await getClassementPublicData();

    const tablesQueried = fromSpy.mock.calls.map((call) => call[0]);
    expect(new Set(tablesQueried)).toEqual(
      new Set(["classement_volume", "classement_reactivite", "profils_publics"]),
    );
    expect(tablesQueried).not.toContain("users");
    expect(tablesQueried).not.toContain("transactions");
    expect(tablesQueried).not.toContain("paiements");
    expect(tablesQueried).not.toContain("classement_progression");
  });

  it("selects only createur_id and rang from the classement views -- never a count or amount", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(fromSpy, selectCalls, {
        volume: [{ createur_id: "a", rang: 1 }],
        reactivite: [{ createur_id: "a", rang: 2 }],
        profils: [{ id: "a", pseudo: "sergio", nom_affichage: null, photo_r2_key: null, createur_verifie: false }],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    await getClassementPublicData();

    const rankSelects = selectCalls.filter((call) => call.table.startsWith("classement_"));
    expect(rankSelects).toHaveLength(2);
    for (const call of rankSelects) {
      expect(call.columns).toBe("createur_id, rang");
    }
  });

  it("selects only the public display columns from profils_publics", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(fromSpy, selectCalls, {
        volume: [{ createur_id: "a", rang: 1 }],
        reactivite: [],
        profils: [{ id: "a", pseudo: "sergio", nom_affichage: null, photo_r2_key: null, createur_verifie: false }],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    await getClassementPublicData();

    const profilSelect = selectCalls.find((call) => call.table === "profils_publics");
    expect(profilSelect?.columns).toBe("id, pseudo, nom_affichage, photo_r2_key, createur_verifie");
  });

  it("returns entries with exactly rank + public display fields -- no leaked count/amount", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(fromSpy, selectCalls, {
        volume: [{ createur_id: "a", rang: 1 }],
        reactivite: [],
        profils: [{ id: "a", pseudo: "sergio", nom_affichage: "Sergio", photo_r2_key: null, createur_verifie: true }],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { volume } = await getClassementPublicData();

    expect(volume).toEqual([
      { createurId: "a", rang: 1, displayName: "Sergio", pseudo: "sergio", photoUrl: null, createurVerifie: true },
    ]);
  });

  it("only signs a photo URL for profiles that actually have one", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      buildClient(fromSpy, selectCalls, {
        volume: [{ createur_id: "a", rang: 1 }],
        reactivite: [],
        profils: [{ id: "a", pseudo: "sergio", nom_affichage: null, photo_r2_key: "photos/a.jpg", createur_verifie: false }],
      }) as unknown as Awaited<ReturnType<typeof createSupabaseServerClient>>,
    );

    const { volume } = await getClassementPublicData();

    expect(volume[0].photoUrl).toBe("https://signed.example/photos/a.jpg");
  });
});
