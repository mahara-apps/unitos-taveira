/**
 * BLINDAGEM DO PORTAL DO CLIENTE — validação de RLS e RPCs.
 *
 * Cobre:
 *  - portal_resolve não expõe campos internos de `clients`
 *  - CLIENTE (portal_client) é somente leitura em posts / post_approvals / monthly_plans
 *  - leitura do portal restrita a conteúdo com visible_in_portal
 *  - isolamento entre clientes e entre marcas (inclusive por ID direto)
 *  - decisão bloqueada em conteúdo já publicado
 *  - escopo multi-cliente do portal autenticado (_client_id validado no banco)
 *  - notificações escopadas (responsável/gestores) e deduplicadas
 *
 * Requer SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_PUBLISHABLE_KEY.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, createUser, testTag, type TestUser } from "./helpers/fixtures";

type Ctx = {
  brandId: string;
  otherBrandId: string;
  clientA: string;
  clientB: string;
  clientOther: string;
  postVisible: string;
  postHidden: string;
  postPublished: string;
  postOtherClient: string;
  planA: string;
  tokenA: string;
  owner: TestUser;
  operator: TestUser;
  portal: TestUser;
};

let cx: Ctx;
const created = { brands: [] as string[], users: [] as string[] };

async function insert<T extends Record<string, unknown>>(table: string, row: T): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as { id: string }).id;
}

beforeAll(async () => {
  const owner = await createUser("portal-owner");
  const operator = await createUser("portal-op");
  const portal = await createUser("portal-client");
  created.users.push(owner.id, operator.id, portal.id);

  const brandId = await insert("brands", {
    name: `QA Portal ${testTag}`,
    slug: `qa-portal-${testTag}`,
    created_by: owner.id,
  });
  const otherBrandId = await insert("brands", {
    name: `QA Portal Other ${testTag}`,
    slug: `qa-portal-other-${testTag}`,
    created_by: owner.id,
  });
  created.brands.push(brandId, otherBrandId);

  // owner é adicionado por trigger; operator entra como membro comum da marca.
  await admin
    .from("brand_members")
    .upsert(
      { brand_id: brandId, user_id: operator.id, role: "user" },
      { onConflict: "brand_id,user_id" },
    );

  const clientA = await insert("clients", {
    brand_id: brandId,
    name: `Cliente A ${testTag}`,
    owner_user_id: operator.id,
    cnpj: "12345678000199",
    description: "dado interno sensivel",
  });
  const clientB = await insert("clients", {
    brand_id: brandId,
    name: `Cliente B ${testTag}`,
    owner_user_id: operator.id,
  });
  const clientOther = await insert("clients", {
    brand_id: otherBrandId,
    name: `Cliente Outra Marca ${testTag}`,
  });

  // portal user vinculado a A e B (multi-cliente), nunca a clientOther.
  for (const cid of [clientA, clientB]) {
    await admin
      .from("client_members")
      .insert({ brand_id: brandId, client_id: cid, user_id: portal.id, role: "portal_client" });
  }

  const postVisible = await insert("posts", {
    brand_id: brandId,
    client_id: clientA,
    title: "Peça liberada",
    visible_in_portal: true,
  });
  const postHidden = await insert("posts", {
    brand_id: brandId,
    client_id: clientA,
    title: "Peça interna",
    visible_in_portal: false,
  });
  const postPublished = await insert("posts", {
    brand_id: brandId,
    client_id: clientA,
    title: "Peça publicada",
    visible_in_portal: true,
    stage: "published",
    published_at: new Date().toISOString(),
  });
  const postOtherClient = await insert("posts", {
    brand_id: brandId,
    client_id: clientB,
    title: "Peça do cliente B",
    visible_in_portal: true,
  });

  const planA = await insert("monthly_plans", {
    brand_id: brandId,
    client_id: clientA,
    title: `Pauta ${testTag}`,
  });

  const tokenA = `qa-portal-${testTag}-a`;
  await insert("portal_tokens", { client_id: clientA, token: tokenA });

  cx = {
    brandId,
    otherBrandId,
    clientA,
    clientB,
    clientOther,
    postVisible,
    postHidden,
    postPublished,
    postOtherClient,
    planA,
    tokenA,
    owner,
    operator,
    portal,
  };
}, 90_000);

afterAll(async () => {
  // Limpeza só de dados criados por este teste (nunca histórico da aplicação).
  for (const b of created.brands) await admin.from("brands").delete().eq("id", b);
  for (const u of created.users) await admin.auth.admin.deleteUser(u);
});

describe("portal_resolve — superfície de dados", () => {
  it("não expõe campos internos do cliente (token)", async () => {
    const c = anonClient();
    const { data, error } = await c.rpc("portal_resolve" as never, { _token: cx.tokenA } as never);
    expect(error).toBeNull();
    const res = data as { client: Record<string, unknown>; clientId: string };
    expect(res.clientId).toBe(cx.clientA);
    expect(Object.keys(res.client).sort()).toEqual(
      [
        "color",
        "contact_email",
        "contact_name",
        "id",
        "logo_url",
        "name",
        "niche",
        "portal_theme",
        "socials",
      ].sort(),
    );
    for (const leak of ["cnpj", "description", "mrr", "owner_user_id", "legal_name", "brand_hub"]) {
      expect(res.client).not.toHaveProperty(leak);
    }
  });

  it("token inválido não resolve", async () => {
    const c = anonClient();
    const { error } = await c.rpc("portal_resolve" as never, { _token: "nao-existe-xyz" } as never);
    expect(error?.message ?? "").toContain("invalid_token");
  });
});

describe("CLIENTE — leitura restrita ao liberado", () => {
  it("vê apenas posts visible_in_portal dos próprios clientes", async () => {
    const { data, error } = await cx.portal.client
      .from("posts")
      .select("id")
      .eq("brand_id", cx.brandId);
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id as string);
    expect(ids).toContain(cx.postVisible);
    expect(ids).toContain(cx.postPublished);
    expect(ids).toContain(cx.postOtherClient); // clientB também é vínculo dele
    expect(ids).not.toContain(cx.postHidden);
  });

  it("não alcança post interno nem por ID direto", async () => {
    const { data } = await cx.portal.client.from("posts").select("id").eq("id", cx.postHidden);
    expect(data ?? []).toHaveLength(0);
  });

  it("não alcança cliente de outra marca", async () => {
    const { data } = await cx.portal.client.from("clients").select("id").eq("id", cx.clientOther);
    expect(data ?? []).toHaveLength(0);
  });

  it("agência continua vendo conteúdo interno", async () => {
    const { data, error } = await cx.operator.client
      .from("posts")
      .select("id")
      .eq("id", cx.postHidden);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toEqual([cx.postHidden]);
  });
});

describe("CLIENTE — ausência de escrita", () => {
  it("não altera posts", async () => {
    const { data, error } = await cx.portal.client
      .from("posts")
      .update({ title: "hack" })
      .eq("id", cx.postVisible)
      .select("id");
    expect(error === null ? (data ?? []).length : 0).toBe(0);
    const { data: check } = await admin
      .from("posts")
      .select("title")
      .eq("id", cx.postVisible)
      .single();
    expect((check as { title: string }).title).toBe("Peça liberada");
  });

  it("não apaga posts", async () => {
    const { data } = await cx.portal.client
      .from("posts")
      .delete()
      .eq("id", cx.postVisible)
      .select("id");
    expect(data ?? []).toHaveLength(0);
    const { count } = await admin
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("id", cx.postVisible);
    expect(count).toBe(1);
  });

  it("não insere posts", async () => {
    const { error } = await cx.portal.client
      .from("posts")
      .insert({ brand_id: cx.brandId, client_id: cx.clientA, title: "injetado" });
    expect(error).not.toBeNull();
  });

  it("não escreve aprovações diretamente", async () => {
    const { error } = await cx.portal.client
      .from("post_approvals")
      .insert({ post_id: cx.postVisible, status: "approved" });
    expect(error).not.toBeNull();
  });

  it("lê pauta mas não altera", async () => {
    const { data: read, error: readErr } = await cx.portal.client
      .from("monthly_plans")
      .select("id")
      .eq("id", cx.planA);
    expect(readErr).toBeNull();
    expect((read ?? []).map((r) => r.id)).toEqual([cx.planA]);

    const { data: upd } = await cx.portal.client
      .from("monthly_plans")
      .update({ title: "hack" })
      .eq("id", cx.planA)
      .select("id");
    expect(upd ?? []).toHaveLength(0);
  });
});

describe("portal_decide — trava de estado", () => {
  it("bloqueia decisão em conteúdo já publicado", async () => {
    const c = anonClient();
    const { error } = await c.rpc(
      "portal_decide" as never,
      {
        _token: cx.tokenA,
        _post_id: cx.postPublished,
        _decision: "approved",
        _identity: "QA",
      } as never,
    );
    expect(error?.message ?? "").toContain("post_already_published");
  });

  it("permite comentário em conteúdo publicado", async () => {
    const c = anonClient();
    const { error } = await c.rpc(
      "portal_decide" as never,
      {
        _token: cx.tokenA,
        _post_id: cx.postPublished,
        _decision: "comment",
        _note: "só um comentário",
        _identity: "QA",
      } as never,
    );
    expect(error).toBeNull();
  });

  it("rejeita conteúdo não liberado ao portal", async () => {
    const c = anonClient();
    const { error } = await c.rpc(
      "portal_decide" as never,
      {
        _token: cx.tokenA,
        _post_id: cx.postHidden,
        _decision: "approved",
        _identity: "QA",
      } as never,
    );
    expect(error?.message ?? "").toContain("post_not_found");
  });

  it("aprova conteúdo liberado e registra decisão", async () => {
    const c = anonClient();
    const { error } = await c.rpc(
      "portal_decide" as never,
      {
        _token: cx.tokenA,
        _post_id: cx.postVisible,
        _decision: "approved",
        _identity: "QA Cliente",
      } as never,
    );
    expect(error).toBeNull();
    const { data } = await admin
      .from("post_approvals")
      .select("status")
      .eq("post_id", cx.postVisible)
      .single();
    expect((data as { status: string }).status).toBe("approved");
  });

  it("recusa ajuste sem nota e preserva a nota anterior", async () => {
    const c = anonClient();
    const ok = await c.rpc(
      "portal_decide" as never,
      {
        _token: cx.tokenA,
        _post_id: cx.postVisible,
        _decision: "adjust",
        _note: "trocar a foto de capa",
        _identity: "QA Cliente",
      } as never,
    );
    expect(ok.error).toBeNull();

    for (const note of [undefined, null, "   "]) {
      const { error } = await c.rpc(
        "portal_decide" as never,
        {
          _token: cx.tokenA,
          _post_id: cx.postVisible,
          _decision: "adjust",
          _note: note,
          _identity: "QA Cliente",
        } as never,
      );
      expect(error?.message ?? "").toContain("note_required");
    }

    const { data } = await admin
      .from("post_approvals")
      .select("status, notes")
      .eq("post_id", cx.postVisible)
      .single();
    const row = data as { status: string; notes: string | null };
    expect(row.status).toBe("adjust");
    expect(row.notes).toBe("trocar a foto de capa");
    const { data: post } = await admin
      .from("posts")
      .select("review_status, rework_notes")
      .eq("id", cx.postVisible)
      .single();
    expect((post as { rework_notes: string | null }).rework_notes).toBe("trocar a foto de capa");
  });
});

describe("Portal autenticado — escopo multi-cliente", () => {
  it("lista os vínculos do usuário", async () => {
    const { data, error } = await cx.portal.client.rpc("portal_my_clients" as never, {} as never);
    expect(error).toBeNull();
    const ids = (data as Array<{ client_id: string }>).map((r) => r.client_id).sort();
    expect(ids).toEqual([cx.clientA, cx.clientB].sort());
  });

  it("resolve o segundo cliente vinculado", async () => {
    const { data, error } = await cx.portal.client.rpc(
      "portal_resolve" as never,
      {
        _client_id: cx.clientB,
      } as never,
    );
    expect(error).toBeNull();
    expect((data as { clientId: string }).clientId).toBe(cx.clientB);
  });

  it("recusa cliente não vinculado", async () => {
    const { error } = await cx.portal.client.rpc(
      "portal_resolve" as never,
      {
        _client_id: cx.clientOther,
      } as never,
    );
    expect(error?.message ?? "").toContain("client_not_allowed");
  });

  it("usuário interno não abre sessão de portal", async () => {
    const { error } = await cx.operator.client.rpc("portal_resolve" as never, {} as never);
    expect(error?.message ?? "").toContain("invalid_token");
  });
});

describe("Notificações do portal", () => {
  it("notifica somente responsável/gestores e deduplica", async () => {
    await admin
      .from("notifications")
      .delete()
      .eq("brand_id", cx.brandId)
      .eq("payload->>post_id", cx.postOtherClient);

    const c = anonClient();
    const args = {
      _token: cx.tokenA,
      _post_id: cx.postOtherClient,
      _decision: "adjust",
      _note: "ajustar",
      _identity: "QA Cliente",
      _client_id: null,
    };
    // o token é do cliente A; a peça é do cliente B → fora do escopo do token
    const out = await c.rpc("portal_decide" as never, args as never);
    expect(out.error?.message ?? "").toContain("post_not_found");

    // decisão válida, duas vezes seguidas (mesma janela) → sem duplicar
    const valid = {
      _token: cx.tokenA,
      _post_id: cx.postVisible,
      _decision: "adjust",
      _note: "ajustar",
      _identity: "QA Cliente",
    };
    await c.rpc("portal_decide" as never, valid as never);
    await c.rpc("portal_decide" as never, valid as never);

    const { data } = await admin
      .from("notifications")
      .select("user_id, dedupe_key")
      .eq("brand_id", cx.brandId)
      .eq("kind", "approval_decision")
      .eq("payload->>post_id", cx.postVisible)
      .eq("payload->>decision", "adjust");

    const rows = (data ?? []) as Array<{ user_id: string; dedupe_key: string | null }>;
    expect(rows.length).toBeGreaterThan(0);
    // um registro por destinatário (deduplicado)
    expect(new Set(rows.map((r) => r.user_id)).size).toBe(rows.length);
    // destinatários válidos: owner da marca + responsável pelo cliente
    const allowed = new Set([cx.owner.id, cx.operator.id]);
    for (const r of rows) expect(allowed.has(r.user_id)).toBe(true);
    // o próprio cliente nunca recebe notificação interna
    expect(rows.some((r) => r.user_id === cx.portal.id)).toBe(false);
    for (const r of rows) expect(r.dedupe_key).toContain("portal_decision:");
  }, 30_000);
});
