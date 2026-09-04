/**
 * FASE 10A — Isolamento de STORAGE por CLIENTE.
 *
 * Buckets cobertos: brand-assets, brand-documents, brand-media.
 * Toda validação acontece na camada de Storage/RLS (policies canônicas
 * `brand_files_scoped_{select,insert,update,delete}` + `storage_scope_allows`).
 *
 * Modelo: SUPER ADMIN → tudo · ADMIN → workspace inteiro ·
 * MANAGER/USER → somente clientes atribuídos · PORTAL → somente arquivos
 * liberados do próprio cliente.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, seed, testTag, type Fixture, type TestUser } from "./helpers/fixtures";

const BUCKETS = ["brand-assets", "brand-documents", "brand-media"] as const;
type Bucket = (typeof BUCKETS)[number];

let fx: Fixture;
const created: Array<{ bucket: Bucket; path: string }> = [];

const body = () => new Blob([`qa-${testTag}`], { type: "text/plain" });

/** Sobe um arquivo com service role (fora de RLS) para servir de alvo de leitura. */
async function seedFile(bucket: Bucket, path: string) {
  const up = await admin.storage.from(bucket).upload(path, body(), {
    contentType: "text/plain",
    upsert: true,
  });
  if (up.error) throw new Error(`seedFile(${bucket}/${path}): ${up.error.message}`);
  created.push({ bucket, path });
  return path;
}

const canRead = async (u: TestUser, bucket: Bucket, path: string) => {
  const { data, error } = await u.client.storage.from(bucket).download(path);
  return !error && !!data;
};

const canInsert = async (u: TestUser, bucket: Bucket, path: string) => {
  const { error } = await u.client.storage.from(bucket).upload(path, body(), {
    contentType: "text/plain",
    upsert: false,
  });
  if (!error) created.push({ bucket, path });
  return !error;
};

const canUpdate = async (u: TestUser, bucket: Bucket, path: string) => {
  const { error } = await u.client.storage.from(bucket).upload(path, body(), {
    contentType: "text/plain",
    upsert: true,
  });
  return !error;
};

const canDelete = async (u: TestUser, bucket: Bucket, path: string) => {
  const { data, error } = await u.client.storage.from(bucket).remove([path]);
  // Storage devolve 200 com lista vazia quando a policy filtra o objeto.
  return !error && Array.isArray(data) && data.length > 0;
};

let fileA: Record<Bucket, string>;
let fileB: Record<Bucket, string>;
let fileOtherWorkspace: string;
let workspaceLevelFile: string;
let portalVisibleDoc: string;
let portalHiddenDoc: string;

beforeAll(async () => {
  fx = await seed();

  // MANAGER passa a ser explicitamente atribuído somente ao cliente A.
  const cm = await admin.from("client_members").insert({
    brand_id: fx.brandId,
    client_id: fx.clientA,
    user_id: fx.userManager.id,
    role: "manager",
  });
  if (cm.error) throw new Error(`client_members(manager): ${cm.error.message}`);

  fileA = {} as Record<Bucket, string>;
  fileB = {} as Record<Bucket, string>;
  for (const b of BUCKETS) {
    fileA[b] = await seedFile(b, `${fx.brandId}/${fx.clientA}/qa-${testTag}-a.txt`);
    fileB[b] = await seedFile(b, `${fx.brandId}/${fx.clientB}/qa-${testTag}-b.txt`);
  }

  fileOtherWorkspace = await seedFile(
    "brand-documents",
    `${fx.otherBrandId}/${fx.otherBrandClient}/qa-${testTag}-w2.txt`,
  );

  // Recurso de workspace (sem client_id determinável no path).
  workspaceLevelFile = await seedFile("brand-assets", `${fx.brandId}/logo_login-${testTag}.txt`);

  // Documentos do Portal: um liberado, um interno.
  portalVisibleDoc = await seedFile(
    "brand-documents",
    `${fx.brandId}/${fx.clientA}/qa-${testTag}-visivel.txt`,
  );
  portalHiddenDoc = await seedFile(
    "brand-documents",
    `${fx.brandId}/${fx.clientA}/qa-${testTag}-interno.txt`,
  );
  const docs = await admin.from("client_documents").insert([
    {
      brand_id: fx.brandId,
      client_id: fx.clientA,
      name: "visivel",
      storage_path: portalVisibleDoc,
      visible_to_client: true,
    },
    {
      brand_id: fx.brandId,
      client_id: fx.clientA,
      name: "interno",
      storage_path: portalHiddenDoc,
      visible_to_client: false,
    },
  ]);
  if (docs.error) throw new Error(`client_documents: ${docs.error.message}`);
}, 180_000);

afterAll(async () => {
  if (fx) {
    await admin.from("client_documents").delete().eq("brand_id", fx.brandId);
  }
  for (const f of created) {
    await admin.storage
      .from(f.bucket)
      .remove([f.path])
      .catch(() => {});
  }
  await cleanup(fx);
}, 180_000);

describe("ADMIN (owner do workspace)", () => {
  it("lê arquivos do cliente A e do cliente B nos três buckets", async () => {
    for (const b of BUCKETS) {
      expect(await canRead(fx.userOwner, b, fileA[b])).toBe(true);
      expect(await canRead(fx.userOwner, b, fileB[b])).toBe(true);
    }
  });

  it("escreve, atualiza e exclui em qualquer cliente do workspace", async () => {
    const p = `${fx.brandId}/${fx.clientB}/qa-${testTag}-admin-w.txt`;
    expect(await canInsert(fx.userOwner, "brand-media", p)).toBe(true);
    expect(await canUpdate(fx.userOwner, "brand-media", p)).toBe(true);
    expect(await canDelete(fx.userOwner, "brand-media", p)).toBe(true);
  });

  it("acessa recurso de nível de workspace (path sem client_id)", async () => {
    expect(await canRead(fx.userOwner, "brand-assets", workspaceLevelFile)).toBe(true);
  });

  it("não alcança arquivo de outro workspace onde não é membro", async () => {
    const outsider = fx.userManager; // membro só de brandId
    expect(await canRead(outsider, "brand-documents", fileOtherWorkspace)).toBe(false);
  });
});

describe("MANAGER atribuído ao cliente A", () => {
  it("lê arquivos do cliente A", async () => {
    for (const b of BUCKETS) {
      expect(await canRead(fx.userManager, b, fileA[b])).toBe(true);
    }
  });

  it("NÃO lê arquivos do cliente B (mesmo workspace)", async () => {
    for (const b of BUCKETS) {
      expect(await canRead(fx.userManager, b, fileB[b])).toBe(false);
    }
  });

  it("NÃO envia arquivo para cliente não atribuído", async () => {
    expect(
      await canInsert(fx.userManager, "brand-media", `${fx.brandId}/${fx.clientB}/qa-mgr-ins.txt`),
    ).toBe(false);
  });

  it("NÃO atualiza nem exclui arquivo de cliente não atribuído", async () => {
    expect(await canUpdate(fx.userManager, "brand-media", fileB["brand-media"])).toBe(false);
    expect(await canDelete(fx.userManager, "brand-media", fileB["brand-media"])).toBe(false);
  });

  it("envia, atualiza e exclui no cliente atribuído", async () => {
    const p = `${fx.brandId}/${fx.clientA}/qa-${testTag}-mgr-ok.txt`;
    expect(await canInsert(fx.userManager, "brand-media", p)).toBe(true);
    expect(await canUpdate(fx.userManager, "brand-media", p)).toBe(true);
    expect(await canDelete(fx.userManager, "brand-media", p)).toBe(true);
  });

  it("NÃO acessa arquivo de workspace onde não é membro (cross-workspace)", async () => {
    expect(await canRead(fx.userManager, "brand-documents", fileOtherWorkspace)).toBe(false);
    expect(
      await canInsert(
        fx.userManager,
        "brand-documents",
        `${fx.otherBrandId}/${fx.otherBrandClient}/qa-mgr-x.txt`,
      ),
    ).toBe(false);
  });
});

describe("USER atribuído ao cliente A", () => {
  it("lê somente o cliente A", async () => {
    for (const b of BUCKETS) {
      expect(await canRead(fx.userA, b, fileA[b])).toBe(true);
      expect(await canRead(fx.userA, b, fileB[b])).toBe(false);
    }
  });

  it("INSERT/UPDATE/DELETE rejeitados no cliente B", async () => {
    expect(
      await canInsert(fx.userA, "brand-documents", `${fx.brandId}/${fx.clientB}/qa-usr-ins.txt`),
    ).toBe(false);
    expect(await canUpdate(fx.userA, "brand-documents", fileB["brand-documents"])).toBe(false);
    expect(await canDelete(fx.userA, "brand-documents", fileB["brand-documents"])).toBe(false);
  });

  it("não acessa recurso de nível de workspace (sem fallback brand member)", async () => {
    expect(await canRead(fx.userA, "brand-assets", workspaceLevelFile)).toBe(false);
    expect(await canRead(fx.userNoLink, "brand-assets", workspaceLevelFile)).toBe(false);
  });

  it("membro do workspace sem cliente atribuído não lê nada", async () => {
    for (const b of BUCKETS) {
      expect(await canRead(fx.userNoLink, b, fileA[b])).toBe(false);
      expect(await canRead(fx.userNoLink, b, fileB[b])).toBe(false);
    }
  });

  it("cross-workspace negado", async () => {
    expect(await canRead(fx.userA, "brand-documents", fileOtherWorkspace)).toBe(false);
  });
});

describe("Paths forjados", () => {
  it("brand_id forjado com cliente de outra marca é rejeitado", async () => {
    // O cliente existe, mas não pertence à brand do path → relação inválida.
    const forged = `${fx.brandId}/${fx.otherBrandClient}/qa-forjado.txt`;
    await seedFile("brand-media", forged);
    expect(await canRead(fx.userOwner, "brand-media", forged)).toBe(false);
    expect(await canRead(fx.userManager, "brand-media", forged)).toBe(false);
    expect(await canInsert(fx.userOwner, "brand-media", `${forged}-2`)).toBe(false);
  });

  it("client_id trocado pelo id de outro cliente não atribuído é rejeitado", async () => {
    expect(await canRead(fx.userA, "brand-media", `${fx.brandId}/${fx.clientB}/qa-${testTag}-b.txt`))
      .toBe(false);
  });

  it("cliente inexistente não concede acesso", async () => {
    const ghost = "00000000-0000-0000-0000-0000000000aa";
    const p = `${fx.brandId}/${ghost}/qa-ghost.txt`;
    await seedFile("brand-media", p);
    expect(await canRead(fx.userOwner, "brand-media", p)).toBe(false);
    expect(await canInsert(fx.userOwner, "brand-media", `${p}-2`)).toBe(false);
  });

  it("workspace inexistente não concede acesso", async () => {
    const ghostBrand = "00000000-0000-0000-0000-0000000000bb";
    const p = `${ghostBrand}/${fx.clientA}/qa-ghost-brand.txt`;
    await seedFile("brand-media", p);
    expect(await canRead(fx.userOwner, "brand-media", p)).toBe(false);
    expect(await canRead(fx.userA, "brand-media", p)).toBe(false);
  });

  it("path sem UUID no primeiro segmento é rejeitado (inclusive escrita)", async () => {
    const p = `nao-uuid/${fx.clientA}/qa.txt`;
    await seedFile("brand-media", p);
    expect(await canRead(fx.userOwner, "brand-media", p)).toBe(false);
    expect(await canInsert(fx.userA, "brand-media", "public/qa-livre.txt")).toBe(false);
  });

  it("cliente órfão (sem owner nem client_members) não é acessível por USER", async () => {
    const p = `${fx.brandId}/${fx.clientOrphan}/qa-orfao.txt`;
    await seedFile("brand-documents", p);
    expect(await canRead(fx.userA, "brand-documents", p)).toBe(false);
    expect(await canRead(fx.userManager, "brand-documents", p)).toBe(false);
    // ADMIN cobre o workspace inteiro.
    expect(await canRead(fx.userOwner, "brand-documents", p)).toBe(true);
  });
});

describe("PORTAL CLIENT", () => {
  it("lê somente documento liberado do próprio cliente", async () => {
    expect(await canRead(fx.userPortal, "brand-documents", portalVisibleDoc)).toBe(true);
    expect(await canRead(fx.userPortal, "brand-documents", portalHiddenDoc)).toBe(false);
  });

  it("lê identidade visual do próprio cliente, mas não mídia interna", async () => {
    expect(await canRead(fx.userPortal, "brand-assets", fileA["brand-assets"])).toBe(true);
    expect(await canRead(fx.userPortal, "brand-media", fileA["brand-media"])).toBe(false);
  });

  it("não acessa nenhum arquivo de outro cliente", async () => {
    for (const b of BUCKETS) {
      expect(await canRead(fx.userPortal, b, fileB[b])).toBe(false);
    }
    expect(await canRead(fx.userPortal, "brand-documents", fileOtherWorkspace)).toBe(false);
  });

  it("é somente leitura: INSERT/UPDATE/DELETE rejeitados no próprio cliente", async () => {
    expect(
      await canInsert(
        fx.userPortal,
        "brand-documents",
        `${fx.brandId}/${fx.clientA}/qa-portal-ins.txt`,
      ),
    ).toBe(false);
    expect(await canUpdate(fx.userPortal, "brand-documents", portalVisibleDoc)).toBe(false);
    expect(await canDelete(fx.userPortal, "brand-documents", portalVisibleDoc)).toBe(false);
  });

  it("não acessa recurso de nível de workspace", async () => {
    expect(await canRead(fx.userPortal, "brand-assets", workspaceLevelFile)).toBe(false);
  });
});
