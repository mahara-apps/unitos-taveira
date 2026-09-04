import { describe, expect, it } from "vitest";
import {
  buildMetaPortfolioStatus,
  readSessionBusinesses,
  type ConnectionRow,
  type SessionRow,
} from "@/lib/meta/authorization-state";
import { accountStatusReason, readPagesPayload } from "@/lib/meta/portfolio-shared";

const NOW = Date.parse("2026-09-01T00:00:00.000Z");

const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  meta_user_id: "admin-owner",
  meta_user_name: "Proprietária",
  meta_user_email: "owner@agencia.com",
  user_token_ciphertext: "cipher",
  user_token_expires_at: null,
  revoked_at: null,
  created_at: "2026-08-01T00:00:00.000Z",
  businesses: [{ id: "bm-1", name: "Portfólio Mahara" }],
  ...over,
});

const conn = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  channel: "instagram",
  status: "active",
  owner_external_id: "admin-owner",
  owner_name: "Proprietária",
  client_id: "client-1",
  created_at: "2026-08-02T00:00:00.000Z",
  meta_business_id: "bm-1",
  meta_business_name: "Portfólio Mahara",
  ...over,
});

describe("Meta para agências — multi-admin e multi-portfólio", () => {
  it("dois administradores Meta do MESMO portfólio compartilham a autorização", () => {
    const status = buildMetaPortfolioStatus(
      [],
      [
        session(),
        session({
          meta_user_id: "admin-jose",
          meta_user_name: "Jose",
          meta_user_email: "jose@mahara.marketing",
          created_at: "2026-08-20T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(status.authorized).toBe(true);
    expect(status.authorizations).toHaveLength(2);
    // Um único portfólio empresarial, alcançado por dois admins.
    expect(status.portfolios).toHaveLength(1);
    expect(status.portfolios[0]!.businessId).toBe("bm-1");
    expect(status.portfolios[0]!.authorizedByMetaUserIds.sort()).toEqual([
      "admin-jose",
      "admin-owner",
    ]);
  });

  it("uma autorização que alcança dois portfólios gera dois cartões", () => {
    const status = buildMetaPortfolioStatus(
      [],
      [
        session({
          businesses: [
            { id: "bm-1", name: "Portfólio A" },
            { id: "bm-2", name: "Portfólio B" },
          ],
        }),
      ],
      NOW,
    );
    expect(status.portfolios.map((p) => p.businessId).sort()).toEqual(["bm-1", "bm-2"]);
    expect(status.portfolios.every((p) => p.authorized)).toBe(true);
  });

  it("canais são agrupados pelo portfólio empresarial, não pelo usuário Meta", () => {
    const status = buildMetaPortfolioStatus(
      [
        conn(),
        conn({
          channel: "facebook",
          owner_external_id: "admin-jose",
          owner_name: "Jose",
          client_id: "client-2",
        }),
        conn({ meta_business_id: "bm-2", meta_business_name: "Portfólio B", client_id: "client-3" }),
      ],
      [session({ businesses: [{ id: "bm-1", name: "Portfólio Mahara" }] })],
      NOW,
    );
    const bm1 = status.portfolios.find((p) => p.businessId === "bm-1")!;
    expect(bm1.channelCount).toBe(2);
    expect(bm1.clientCount).toBe(2);
    const bm2 = status.portfolios.find((p) => p.businessId === "bm-2")!;
    expect(bm2.channelCount).toBe(1);
    // Sem autorização alcançando bm-2, ele não é autorizado.
    expect(bm2.authorized).toBe(false);
  });

  it("sessão revogada ou expirada não autoriza portfólio algum", () => {
    expect(
      buildMetaPortfolioStatus([], [session({ revoked_at: "2026-08-25T00:00:00.000Z" })], NOW)
        .authorized,
    ).toBe(false);
    expect(
      buildMetaPortfolioStatus(
        [],
        [session({ user_token_expires_at: "2026-08-20T00:00:00.000Z" })],
        NOW,
      ).authorized,
    ).toBe(false);
  });

  it("linhas legadas sem meta_business_id caem no agrupamento por usuário Meta", () => {
    const status = buildMetaPortfolioStatus(
      [conn({ meta_business_id: null, meta_business_name: null })],
      [session({ businesses: [] })],
      NOW,
    );
    expect(status.portfolios).toHaveLength(1);
    expect(status.portfolios[0]!.legacyIdentity).toBe(true);
    expect(status.portfolios[0]!.ownerExternalId).toBe("admin-owner");
  });

  it("readSessionBusinesses ignora payload inválido", () => {
    expect(readSessionBusinesses(null)).toEqual([]);
    expect(readSessionBusinesses([{ name: "sem id" }, { id: "bm-9" }])).toEqual([
      { id: "bm-9", name: null },
    ]);
  });

  it("cache de portfólio expõe empresas e identidade de business nas páginas", () => {
    const payload = readPagesPayload({
      pages: [{ pageId: "p1", pageName: "Página", businessId: "bm-1", businessName: "BM" }],
      standaloneInstagram: [],
      warnings: [],
      businessCount: 1,
      businesses: [{ id: "bm-1", name: "BM" }],
    });
    expect(payload.businesses).toEqual([{ id: "bm-1", name: "BM" }]);
    expect(payload.pages[0]!.businessId).toBe("bm-1");
  });

  it("conta não autorizada recebe motivo acionável", () => {
    const auth = {
      unavailable: false,
      facebook: { granted: true, broad: false, targets: ["p-1"] },
      instagram: { granted: true, broad: false, targets: [] },
    } as never;
    expect(accountStatusReason(auth, "facebook", "p-999")).toContain("não foi selecionado");
    expect(accountStatusReason(auth, "facebook", "p-1")).toBeNull();
  });
});
