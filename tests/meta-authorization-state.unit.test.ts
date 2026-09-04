import { describe, expect, it } from "vitest";
import {
  buildMetaPortfolioStatus,
  isSessionAuthorized,
  type ConnectionRow,
  type SessionRow,
} from "@/lib/meta/authorization-state";

const NOW = Date.parse("2026-08-30T00:00:00.000Z");

const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  meta_user_id: "port-1",
  meta_user_name: "Portfólio Um",
  meta_user_email: "a@b.com",
  user_token_ciphertext: "cipher",
  user_token_expires_at: null,
  revoked_at: null,
  created_at: "2026-08-01T00:00:00.000Z",
  ...over,
});

const conn = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  channel: "instagram",
  status: "active",
  owner_external_id: "port-1",
  owner_name: "Portfólio Um",
  client_id: "client-1",
  created_at: "2026-08-02T00:00:00.000Z",
  ...over,
});

describe("estado de autorização Meta", () => {
  it("1. autorização válida sem social_connections = portfólio autorizado", () => {
    const s = buildMetaPortfolioStatus([], [session()], NOW);
    expect(s.authorized).toBe(true);
    expect(s.portfolios).toHaveLength(1);
    expect(s.portfolios[0]).toMatchObject({
      ownerExternalId: "port-1",
      authorized: true,
      channelCount: 0,
      clientCount: 0,
    });
    expect(s.metaUserName).toBe("Portfólio Um");
  });

  it("2. autorização válida com social_connections conta canais e clientes", () => {
    const s = buildMetaPortfolioStatus(
      [conn(), conn({ channel: "facebook" }), conn({ status: "revoked" })],
      [session()],
      NOW,
    );
    expect(s.authorized).toBe(true);
    expect(s.portfolios[0]).toMatchObject({
      authorized: true,
      channelCount: 2,
      activeCount: 2,
      clientCount: 1,
    });
    expect(s.portfolios[0]!.channels.sort()).toEqual(["facebook", "instagram"]);
  });

  it("3. autorização revogada/expirada não autoriza; histórico não volta a autorizar", () => {
    expect(isSessionAuthorized(session({ revoked_at: NOW.toString() }), NOW)).toBe(false);
    expect(
      isSessionAuthorized(session({ user_token_expires_at: "2026-01-01T00:00:00.000Z" }), NOW),
    ).toBe(false);
    expect(isSessionAuthorized(session({ user_token_ciphertext: null }), NOW)).toBe(false);

    const s = buildMetaPortfolioStatus(
      [conn({ status: "revoked" })],
      [session({ revoked_at: "2026-08-20T00:00:00.000Z" })],
      NOW,
    );
    expect(s.authorized).toBe(false);
    expect(s.portfolios).toHaveLength(0);
    expect(s.metaUserName).toBeNull();
  });

  it("4. troca de portfólio: nova sessão autoriza e conexão anterior segue visível", () => {
    const s = buildMetaPortfolioStatus(
      [conn()],
      [
        session({
          meta_user_id: "port-2",
          meta_user_name: "Portfólio Dois",
          created_at: "2026-08-29T00:00:00.000Z",
        }),
      ],
      NOW,
    );
    expect(s.authorized).toBe(true);
    expect(s.metaUserName).toBe("Portfólio Dois");
    const p1 = s.portfolios.find((p) => p.ownerExternalId === "port-1")!;
    const p2 = s.portfolios.find((p) => p.ownerExternalId === "port-2")!;
    expect(p1.channelCount).toBe(1);
    expect(p1.authorized).toBe(false);
    expect(p2.authorized).toBe(true);
    expect(p2.channelCount).toBe(0);
  });

  it("5. contas disponíveis após OAuth: autorização reconhecida sem canais", () => {
    // Cenário do bug: 87 contas descobertas, 0 conexões.
    const s = buildMetaPortfolioStatus([], [session({ user_token_expires_at: null })], NOW);
    expect(s.authorized).toBe(true);
    expect(s.portfolios[0]!.channelCount).toBe(0);
    expect(s.portfolios[0]!.authorized).toBe(true);
  });

  it("conexões sem portfólio identificado são agrupadas sem quebrar a autorização", () => {
    const s = buildMetaPortfolioStatus(
      [conn({ owner_external_id: null, owner_name: null, client_id: null })],
      [session()],
      NOW,
    );
    expect(s.portfolios).toHaveLength(2);
    expect(s.portfolios.find((p) => p.ownerExternalId === null)!.authorized).toBe(false);
  });
});
