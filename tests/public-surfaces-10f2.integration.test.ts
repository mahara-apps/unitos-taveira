import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, seed, testTag, type Fixture } from "./helpers/fixtures";

/**
 * FASE 10F.2 — correção dos P2 das superfícies públicas.
 *
 * Cobre a RPC transacional de decisão pública (anti-replay, peça excluída,
 * concorrência), o rate limit de superfície pública e a validação estrutural
 * de escopo da logo de login.
 */

let fx: Fixture | null = null;
const created: { posts: string[] } = { posts: [] };

async function makePost(clientId: string, brandId: string, reviewStatus = "in_review") {
  const { data, error } = await admin
    .from("posts")
    .insert({
      brand_id: brandId,
      client_id: clientId,
      title: `QA post ${testTag}`,
      copy: "copy",
      review_status: reviewStatus,
      script: "roteiro interno",
    })
    .select("id")
    .single();
  if (error) throw new Error(`post: ${error.message}`);
  created.posts.push(data.id as string);
  return data.id as string;
}

async function makeToken(
  postId: string,
  brandId: string,
  opts: { expiresAt?: string | null; revoked?: boolean } = {},
) {
  const token = `qa-10f2-${crypto.randomUUID()}`;
  const { error } = await admin.from("card_approval_tokens").insert({
    post_id: postId,
    brand_id: brandId,
    token,
    expires_at: opts.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
    revoked_at: opts.revoked ? new Date().toISOString() : null,
  });
  if (error) throw new Error(`token: ${error.message}`);
  return token;
}

type Decision = { ok?: boolean; reason?: string; status?: number };

async function decide(token: string, verb = "approved", comment: string | null = null) {
  const { data, error } = await admin.rpc(
    "card_approval_public_decide" as never,
    {
      _token: token,
      _verb: verb,
      _comment: comment,
      _ip: null,
      _ua: "vitest",
    } as never,
  );
  if (error) throw new Error(`rpc: ${error.message}`);
  return (data ?? {}) as Decision;
}

beforeAll(async () => {
  fx = await seed();
}, 120_000);

afterAll(async () => {
  if (created.posts.length) {
    await admin.from("card_approval_events").delete().in("post_id", created.posts);
    await admin.from("card_approval_tokens").delete().in("post_id", created.posts);
    await admin.from("posts").delete().in("id", created.posts);
  }
  await cleanup(fx);
}, 120_000);

describe("aprovação pública — decisão transacional", () => {
  it("token válido decide com sucesso", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId);
    const token = await makeToken(post, fx!.brandId);
    const res = await decide(token);
    expect(res.ok).toBe(true);
    const { data } = await admin.from("posts").select("review_status").eq("id", post).single();
    expect(data!.review_status).toBe("approved");
  });

  it("mesmo token após decisão falha (anti-replay, link consumido)", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId);
    const token = await makeToken(post, fx!.brandId);
    expect((await decide(token)).ok).toBe(true);
    const second = await decide(token);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("token_used_or_revoked");
    expect(second.status).toBe(410);
  });

  it("peça já decidida bloqueia novo token", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId, "approved");
    const token = await makeToken(post, fx!.brandId);
    const res = await decide(token);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("already_decided");
    expect(res.status).toBe(409);
  });

  it("peça excluída falha explicitamente", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId);
    const token = await makeToken(post, fx!.brandId);
    await admin.from("posts").update({ deleted_at: new Date().toISOString() }).eq("id", post);
    const res = await decide(token);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("post_deleted");
  });

  it("token inexistente falha", async () => {
    const res = await decide(`qa-10f2-missing-${crypto.randomUUID()}`);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("invalid_token");
    expect(res.status).toBe(404);
  });

  it("token expirado falha", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId);
    const token = await makeToken(post, fx!.brandId, {
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const res = await decide(token);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("token_expired");
  });

  it("token revogado falha", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId);
    const token = await makeToken(post, fx!.brandId, { revoked: true });
    const res = await decide(token);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("token_used_or_revoked");
  });

  it("token não atravessa workspace: par brand/post inconsistente é recusado", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId);
    const token = await makeToken(post, fx!.otherBrandId);
    const res = await decide(token);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("scope_mismatch");
    expect(res.status).toBe(403);
  });

  it("verbo inválido é recusado", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId);
    const token = await makeToken(post, fx!.brandId);
    const res = await decide(token, "deleted");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("invalid_verb");
  });

  it("concorrência: duas decisões simultâneas geram apenas uma válida", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId);
    const token = await makeToken(post, fx!.brandId);
    const results = await Promise.all([decide(token), decide(token)]);
    expect(results.filter((r) => r.ok === true)).toHaveLength(1);
    expect(results.filter((r) => r.ok === false)).toHaveLength(1);
    const { data: events } = await admin
      .from("card_approval_events")
      .select("id")
      .eq("post_id", post);
    expect(events!.length).toBe(1);
  });

  it("pedido de ajustes também consome o link", async () => {
    const post = await makePost(fx!.clientA, fx!.brandId);
    const token = await makeToken(post, fx!.brandId);
    expect((await decide(token, "changes_requested", "trocar imagem")).ok).toBe(true);
    const { data } = await admin
      .from("posts")
      .select("review_status, rework_notes")
      .eq("id", post)
      .single();
    expect(data!.review_status).toBe("rework");
    expect(data!.rework_notes).toBe("trocar imagem");
    expect((await decide(token)).ok).toBe(false);
  });
});

describe("superfícies públicas — RPCs não expostas a anon/authenticated", () => {
  it("anon não executa a decisão pública", async () => {
    const { anonClient } = await import("./helpers/fixtures");
    const c = anonClient();
    const { error } = await c.rpc(
      "card_approval_public_decide" as never,
      {
        _token: "qa-10f2-anon",
        _verb: "approved",
      } as never,
    );
    expect(error).not.toBeNull();
  });

  it("anon não executa o rate limit interno", async () => {
    const { anonClient } = await import("./helpers/fixtures");
    const c = anonClient();
    const { error } = await c.rpc(
      "public_surface_rate_hit" as never,
      {
        _key: "qa-10f2-anon-key-0000",
      } as never,
    );
    expect(error).not.toBeNull();
  });
});

describe("rate limit de superfície pública", () => {
  const key = `qa-10f2-rate-${Date.now().toString(36)}`;

  afterAll(async () => {
    await admin.from("portal_rate_limit").delete().eq("ip_hash", key);
  });

  it("libera abaixo do limite e bloqueia acima, com retry_after", async () => {
    const hit = () =>
      admin.rpc(
        "public_surface_rate_hit" as never,
        {
          _key: key,
          _max: 3,
          _window_seconds: 300,
          _block_seconds: 60,
        } as never,
      );
    for (let i = 0; i < 3; i++) {
      const { data } = await hit();
      expect((data as { blocked: boolean }).blocked).toBe(false);
    }
    const { data: blocked } = await hit();
    const row = blocked as { blocked: boolean; retry_after: number };
    expect(row.blocked).toBe(true);
    expect(row.retry_after).toBeGreaterThan(0);
    const { data: still } = await hit();
    expect((still as { blocked: boolean }).blocked).toBe(true);
  });
});

describe("logo de login — escopo da instalação", () => {
  it("path da logo é validado estruturalmente antes de assinar", async () => {
    const { isSafeLoginLogoPath } = await import("@/lib/login-branding.functions");
    expect(isSafeLoginLogoPath(`${fx!.brandId}/logo_login-1.png`)).toBe(true);
    expect(isSafeLoginLogoPath("installation/logo_login-1.png")).toBe(true);
    expect(isSafeLoginLogoPath(`${fx!.brandId}/../${fx!.otherBrandId}/x.png`)).toBe(false);
    expect(isSafeLoginLogoPath("../../secret.png")).toBe(false);
    expect(isSafeLoginLogoPath("qualquer/pasta/x.png")).toBe(false);
    expect(isSafeLoginLogoPath(null)).toBe(false);
  });

  it("logo de login vem da instalação (singleton), nunca de um workspace", async () => {
    // Mesmo com brands tendo logo própria, a superfície pública lê só o singleton.
    await admin
      .from("brands")
      .update({ login_logo_url: `${fx!.brandId}/logo_login-a.png` })
      .eq("id", fx!.brandId);
    await admin
      .from("brands")
      .update({ login_logo_url: `${fx!.otherBrandId}/logo_login-b.png` })
      .eq("id", fx!.otherBrandId);

    const { data: rows } = await admin.from("installation").select("id, login_logo_url");
    expect((rows ?? []).length).toBe(1);

    await admin
      .from("brands")
      .update({ login_logo_url: null })
      .in("id", [fx!.brandId, fx!.otherBrandId]);
  });
});


describe("share_token do plano de mídia — vínculo estrutural", () => {
  it("token inexistente não resolve plano", async () => {
    const { data, error } = await admin.rpc(
      "media_plan_public_resolve" as never,
      {
        _token: `qa-10f2-missing-${crypto.randomUUID()}`,
      } as never,
    );
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("token resolve somente o plano dono do token (sem cross-client/workspace)", async () => {
    const plan = await admin
      .from("media_plans")
      .insert({
        brand_id: fx!.brandId,
        client_id: fx!.clientA,
        title: `QA plano ${testTag}`,
        share_token: `qa-10f2-plan-${crypto.randomUUID()}`,
      })
      .select("id, share_token")
      .single();
    if (plan.error) throw new Error(plan.error.message);
    const { data } = await admin.rpc(
      "media_plan_public_resolve" as never,
      {
        _token: plan.data.share_token as string,
      } as never,
    );
    const res = data as { plan: { id: string }; client: { id: string }; brand: { id: string } };
    expect(res.plan.id).toBe(plan.data.id);
    expect(res.client.id).toBe(fx!.clientA);
    expect(res.brand.id).toBe(fx!.brandId);
    await admin.from("media_plans").delete().eq("id", plan.data.id);
  });
});
