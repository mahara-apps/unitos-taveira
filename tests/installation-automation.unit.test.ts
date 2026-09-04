import { describe, expect, it, vi } from "vitest";

import {
  assertSecretsAreExclusive,
  automationOutcome,
  buildDeployEnvPlan,
  extractProjectRef,
  resolveAutomationCapability,
  resolveAutomationTarget,
  resolveOperationalUrl,
} from "@/lib/installation/automation-contract";
import {
  createDeployClient,
  createManagementClient,
  generateInstallationSecret,
  runAutomatedProvision,
} from "@/lib/installation/automation.server";

const MASTER_REF = "tkjbhttylouamqxnbfgv";

/** Respostas mínimas do GitHub usadas pelo provisionamento (código publicado). */
const githubResponse = (url: string): Response | null => {
  if (!url.includes("api.github.com")) return null;
  if (url.includes("/git/trees")) return Response.json({ tree: [] });
  if (url.includes("/git/ref/heads/")) return Response.json({ object: { sha: "sha_dest" } });
  if (url.includes("/commits/main")) return Response.json({ sha: "sha_master" });
  if (url.includes("/git/blobs")) return Response.json({ sha: "blob_1", content: "", encoding: "base64" });
  if (url.includes("/git/commits")) return Response.json({ sha: "commit_1" });
  if (url.includes("/git/refs")) return Response.json({ ok: true });
  return Response.json({ full_name: "acme/unitos-pitada" });
};

describe("credenciais de gestão do MASTER", () => {
  it("BLOCKED quando as credenciais próprias não existem", () => {
    const cap = resolveAutomationCapability({});
    expect(cap.available).toBe(false);
    expect(cap.blockedReasons.length).toBe(3);
    expect(cap.blockedReasons.join(" ")).toContain("UNITOS_SUPABASE_MANAGEMENT_TOKEN");
  });

  it("disponível somente com Supabase management + deploy + GitHub", () => {
    expect(resolveAutomationCapability({ UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t" }).available).toBe(false);
    expect(
      resolveAutomationCapability({ UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t", UNITOS_VERCEL_TOKEN: "v" }).available,
    ).toBe(false);
    expect(
      resolveAutomationCapability({
        UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t",
        UNITOS_VERCEL_TOKEN: "v",
        UNITOS_GITHUB_TOKEN: "g",
      }).available,
    ).toBe(true);
  });
});

describe("alvo do provisionamento automático", () => {
  it("aceita ref explícito e extrai da URL", () => {
    expect(extractProjectRef({ supabaseUrl: "https://abcdefghijklmnop.supabase.co" })).toBe(
      "abcdefghijklmnop",
    );
    const target = resolveAutomationTarget({
      supabaseUrl: "https://abcdefghijklmnop.supabase.co",
      deployProject: "unitos-pitada",
    });
    expect(target).toEqual({ ok: true, projectRef: "abcdefghijklmnop", deployProject: "unitos-pitada" });
  });

  it("recusa alvo que aponta para o MASTER", () => {
    const target = resolveAutomationTarget({
      supabaseUrl: `https://${MASTER_REF}.supabase.co`,
      deployProject: "x",
    });
    expect(target.ok).toBe(false);
  });

  it("não exige domínio definitivo, mas exige projeto de deploy", () => {
    const noDeploy = resolveAutomationTarget({ supabaseUrl: "https://abcdefghijklmnop.supabase.co" });
    expect(noDeploy.ok).toBe(false);
    const withDeploy = resolveAutomationTarget({
      supabaseUrl: "https://abcdefghijklmnop.supabase.co",
      deployProject: "p",
      domain: null,
    });
    expect(withDeploy.ok).toBe(true);
  });
});

describe("secrets exclusivos da instalação", () => {
  it("gera valores longos e distintos", () => {
    const a = generateInstallationSecret();
    const b = generateInstallationSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(48);
  });

  it("recusa reuso de secret do MASTER", () => {
    const shared = generateInstallationSecret();
    const result = assertSecretsAreExclusive({
      generated: {
        CRON_SECRET: shared,
        BRAND_CREDENTIALS_SECRET: generateInstallationSecret(),
        META_STATE_SECRET: generateInstallationSecret(),
        META_WEBHOOK_VERIFY_TOKEN: generateInstallationSecret(),
      },
      masterEnv: { CRON_SECRET: shared },
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("MASTER");
  });

  it("recusa secret ausente ou curto", () => {
    expect(assertSecretsAreExclusive({ generated: {}, masterEnv: {} }).ok).toBe(false);
    expect(
      assertSecretsAreExclusive({
        generated: {
          CRON_SECRET: "curto",
          BRAND_CREDENTIALS_SECRET: generateInstallationSecret(),
          META_STATE_SECRET: generateInstallationSecret(),
          META_WEBHOOK_VERIFY_TOKEN: generateInstallationSecret(),
        },
        masterEnv: {},
      }).ok,
    ).toBe(false);
  });
});

describe("URL operacional automática", () => {
  it("usa a URL temporária do deploy quando não há domínio definitivo", () => {
    const url = resolveOperationalUrl({ deploymentUrl: "https://unitos-pitada-abc.vercel.app" });
    expect(url).toEqual({
      ok: true,
      origin: "https://unitos-pitada-abc.vercel.app",
      kind: "temporary",
      source: "deploy",
    });
  });

  it("prefere o domínio definitivo quando existe", () => {
    const url = resolveOperationalUrl({
      customDomain: "https://app.pitada.com.br",
      deploymentUrl: "https://unitos-pitada-abc.vercel.app",
    });
    expect(url.ok && url.source).toBe("custom_domain");
  });

  it("normaliza domínio definitivo sem protocolo para HTTPS", () => {
    const url = resolveOperationalUrl({
      customDomain: "app.pitada.com.br",
      deploymentUrl: "https://unitos-pitada-abc.vercel.app",
    });
    expect(url).toEqual({
      ok: true,
      origin: "https://app.pitada.com.br",
      kind: "custom",
      source: "custom_domain",
    });
  });

  it("mantém a proteção anti-MASTER ao normalizar domínio sem protocolo", () => {
    const url = resolveOperationalUrl({
      customDomain: "unitos-master.lovable.app",
      deploymentUrl: "https://unitos-pitada-abc.vercel.app",
    });
    expect(url.ok).toBe(false);
    if (!url.ok) expect(url.reason).toContain("MASTER");
  });

  it("BLOCKED sem domínio e sem URL de deploy", () => {
    const url = resolveOperationalUrl({});
    expect(url.ok).toBe(false);
  });
});

describe("plano de variáveis do deploy", () => {
  const base = {
    appUrl: "https://unitos-pitada-abc.vercel.app",
    supabaseUrl: "https://abcdefghijklmnop.supabase.co",
    publishableKey: "sb_publishable_x",
    serviceRoleKey: "sb_secret_x",
    projectRef: "abcdefghijklmnop",
    secrets: {
      CRON_SECRET: generateInstallationSecret(),
      BRAND_CREDENTIALS_SECRET: generateInstallationSecret(),
      META_STATE_SECRET: generateInstallationSecret(),
      META_WEBHOOK_VERIFY_TOKEN: generateInstallationSecret(),
    },
  };

  it("inclui URL, chaves do destino e os 4 secrets próprios", () => {
    const plan = buildDeployEnvPlan(base);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const keys = plan.entries.map((e) => e.key);
    expect(keys).toContain("PUBLIC_APP_URL");
    expect(keys).toContain("CRON_SECRET");
    expect(keys).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(plan.entries.find((e) => e.key === "SUPABASE_SERVICE_ROLE_KEY")?.sensitive).toBe(true);
  });

  it("recusa plano que aponta para o MASTER", () => {
    const plan = buildDeployEnvPlan({ ...base, projectRef: MASTER_REF });
    expect(plan.ok).toBe(false);
  });

  it("recusa plano com secret ausente", () => {
    const plan = buildDeployEnvPlan({ ...base, secrets: { CRON_SECRET: "x".repeat(40) } });
    expect(plan.ok).toBe(false);
  });

  it("propaga o App Meta oficial e o Redirect URI da própria instalação", () => {
    const plan = buildDeployEnvPlan({
      ...base,
      officialMetaApp: { appId: "111", appSecret: "sec", businessConfigId: "222" },
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const get = (k: string) => plan.entries.find((e) => e.key === k);
    expect(get("META_APP_ID")?.value).toBe("111");
    expect(get("META_APP_SECRET")?.sensitive).toBe(true);
    expect(get("META_BUSINESS_CONFIG_ID")?.value).toBe("222");
    expect(get("META_REDIRECT_URI")?.value).toContain("/api/public/meta/callback");
    expect(get("META_REDIRECT_URI")?.value.startsWith("https://")).toBe(true);
  });

  it("sem App Meta oficial no MASTER o plano segue válido, apenas sem variáveis Meta", () => {
    const plan = buildDeployEnvPlan({ ...base, officialMetaApp: null });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.entries.some((e) => e.key.startsWith("META_APP"))).toBe(false);
  });
});

describe("resultado do fluxo automatizado", () => {
  it("nunca é PASS com falha ou bloqueio", () => {
    expect(automationOutcome({}).result).toBe("PASS");
    expect(automationOutcome({ blocked: ["sem token"] }).result).toBe("BLOCKED");
    expect(automationOutcome({ blocked: ["x"], failures: ["y"] }).result).toBe("FAIL");
  });
});

/* --------------------------------------------------- execução com fetch mock */

function fakeClient(detail: Record<string, unknown> = {}) {
  const updates: Record<string, unknown>[] = [];
  const api = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { status: "running", steps: [], detail } }),
        }),
      }),
    }),
  };
  return { api, updates };
}


const OP = {
  id: "00000000-0000-0000-0000-000000000001",
  installation_id: "00000000-0000-0000-0000-000000000002",
  kind: "provision",
  status: "running",
  steps: [],
  detail: {},
  summary: null,
  run_token_expires_at: null,
};

const INSTALLATION = {
  id: OP.installation_id,
  domain: null,
  supabaseUrl: "https://abcdefghijklmnop.supabase.co",
  supabaseProjectRef: "abcdefghijklmnop",
  deployProject: "unitos-pitada",
  gitRepoUrl: "https://github.com/acme/unitos-pitada",
};

const runProvision = (
  input: Parameters<typeof runAutomatedProvision>[0],
) => runAutomatedProvision({ ...input, maxStatementsPerInvocation: Number.POSITIVE_INFINITY });

describe("runAutomatedProvision", () => {
  it("BLOCKED sem credenciais de gestão — sem nenhuma chamada externa", async () => {
    const { api } = fakeClient();
    const fetchImpl = vi.fn();
    const result = await runProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env: {},
      fetchImpl: fetchImpl as never,
    });
    expect(result.result).toBe("BLOCKED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("BLOCKED quando o Supabase destino não responde", async () => {
    const { api } = fakeClient();
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 }));
    const result = await runProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env: { UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t", UNITOS_VERCEL_TOKEN: "v", UNITOS_GITHUB_TOKEN: "g" },
      fetchImpl: fetchImpl as never,
    });
    expect(result.result).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("Supabase destino");
  });

  it("PASS ponta a ponta usando a URL temporária do deploy", async () => {
    const { api } = fakeClient();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      const gh = githubResponse(url);
      if (gh) return gh;
      calls.push(url);
      if (url.includes("/api-keys")) {
        return Response.json([
          { name: "anon", api_key: "sb_publishable_x" },
          { name: "service_role", api_key: "sb_secret_x" },
        ]);
      }
      if (url.includes("/database/query")) {
        return Response.json([{ schemas: 3, item: "ok" }]);
      }
      if (url.includes("api.vercel.com/v9/projects")) {
        return Response.json({ name: "unitos-pitada", targets: { production: { url: "unitos-pitada-abc.vercel.app" } } });
      }
      if (url.includes("/env")) return Response.json({ created: [] });
      if (url.includes("api.vercel.com/v6/deployments")) {
        return Response.json({ deployments: [{ uid: "dpl_1", name: "unitos-pitada" }] });
      }
      if (url.includes("api.vercel.com/v13/deployments")) {
        return Response.json({ id: "dpl_2" });
      }
      return new Response("{}", { status: 200 });
    });

    const result = await runProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env: { UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t", UNITOS_VERCEL_TOKEN: "v", UNITOS_GITHUB_TOKEN: "g" },
      fetchImpl: fetchImpl as never,
    });

    expect(result.result).toBe("PASS");
    expect(result.appUrl).toBe("https://unitos-pitada-abc.vercel.app");
    expect(result.urlSource).toBe("deploy");
    expect(calls.some((c) => c.includes("/env"))).toBe(true);
    // Redeploy real disparado e URL operacional testada por HTTP.
    expect(calls.some((c) => c.includes("v13/deployments"))).toBe(true);
    expect(calls.some((c) => c === "https://unitos-pitada-abc.vercel.app")).toBe(true);
    expect(result.steps.every((s) => s.state === "done")).toBe(true);
  });

  it("prepara o banco ANTES de gravar o segredo de cron e as variáveis do deploy", async () => {
    const { api } = fakeClient();
    const order: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: { body?: unknown }) => {
      const gh = githubResponse(url);
      if (gh) return gh;
      if (url.includes("/api-keys")) {
        return Response.json([
          { name: "anon", api_key: "sb_publishable_x" },
          { name: "service_role", api_key: "sb_secret_x" },
        ]);
      }
      if (url.includes("/database/query")) {
        const body = String((init?.body as string) ?? "");
        if (body.includes("select public.set_cron_secret(")) {
          order.push("cron_secret");
          expect(body).toContain("create or replace function public.set_cron_secret(_value text)");
          expect(body).toMatch(/select public\.set_cron_secret\('[^']+'::text\)/);
        }
        else if (body.includes("create table") || body.includes("CREATE TABLE")) {
          if (!order.includes("baseline")) order.push("baseline");
        }
        return Response.json([{ schemas: 3, item: "ok" }]);
      }
      if (url.includes("api.vercel.com/v9/projects")) {
        return Response.json({
          name: "unitos-pitada",
          targets: { production: { url: "unitos-pitada-abc.vercel.app" } },
        });
      }
      if (url.includes("/env")) {
        order.push("env");
        return Response.json({ created: [] });
      }
      if (url.includes("api.vercel.com/v6/deployments")) {
        return Response.json({ deployments: [{ uid: "dpl_1", name: "unitos-pitada" }] });
      }
      if (url.includes("api.vercel.com/v13/deployments")) return Response.json({ id: "dpl_2" });
      return new Response("{}", { status: 200 });
    });

    const result = await runProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env: {
        UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t",
        UNITOS_VERCEL_TOKEN: "v",
        UNITOS_GITHUB_TOKEN: "g",
      },
      fetchImpl: fetchImpl as never,
    });

    expect(result.result).toBe("PASS");
    expect(order.indexOf("baseline")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("cron_secret")).toBeGreaterThan(order.indexOf("baseline"));
    expect(order.indexOf("env")).toBeGreaterThan(order.indexOf("cron_secret"));
  });



  it("avisa (sem quebrar) quando o redeploy não pode ser disparado", async () => {
    const { api } = fakeClient();
    const fetchImpl = vi.fn(async (url: string) => {
      const gh = githubResponse(url);
      if (gh) return gh;
      if (url.includes("/api-keys")) {
        return Response.json([
          { name: "anon", api_key: "k" },
          { name: "service_role", api_key: "s" },
        ]);
      }
      if (url.includes("/database/query")) return Response.json([{ schemas: 3, status: "PASS" }]);
      if (url.includes("api.vercel.com/v9/projects")) {
        return Response.json({ name: "x", targets: { production: { url: "x-abc.vercel.app" } } });
      }
      if (url.includes("/env")) return Response.json({ created: [] });
      if (url.includes("v6/deployments")) return Response.json({ deployments: [] });
      return new Response("{}", { status: 200 });
    });
    const result = await runProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env: { UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t", UNITOS_VERCEL_TOKEN: "v", UNITOS_GITHUB_TOKEN: "g" },
      fetchImpl: fetchImpl as never,
    });
    expect(result.result).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("deployment");
  });

  it("frontend fica em atenção quando a URL operacional não responde", async () => {
    const { api } = fakeClient();
    const fetchImpl = vi.fn(async (url: string) => {
      const gh = githubResponse(url);
      if (gh) return gh;
      if (url.includes("/api-keys")) {
        return Response.json([
          { name: "anon", api_key: "k" },
          { name: "service_role", api_key: "s" },
        ]);
      }
      if (url.includes("/database/query")) return Response.json([{ schemas: 3, status: "PASS" }]);
      if (url.includes("api.vercel.com/v9/projects")) {
        return Response.json({ name: "x", targets: { production: { url: "x-abc.vercel.app" } } });
      }
      if (url.includes("/env")) return Response.json({ created: [] });
      if (url.includes("v6/deployments")) {
        return Response.json({ deployments: [{ uid: "d", name: "x" }] });
      }
      if (url.includes("v13/deployments")) return Response.json({ id: "d2" });
      if (url === "https://x-abc.vercel.app") return new Response("erro", { status: 502 });
      return new Response("{}", { status: 200 });
    });
    const result = await runProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env: { UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t", UNITOS_VERCEL_TOKEN: "v", UNITOS_GITHUB_TOKEN: "g" },
      fetchImpl: fetchImpl as never,
    });
    expect(result.result).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("Frontend");
  });

  it("BLOCKED quando o deploy não expõe URL e não há domínio", async () => {
    const { api } = fakeClient();
    const fetchImpl = vi.fn(async (url: string) => {
      const gh = githubResponse(url);
      if (gh) return gh;
      if (url.includes("/api-keys")) {
        return Response.json([
          { name: "anon", api_key: "k" },
          { name: "service_role", api_key: "s" },
        ]);
      }
      if (url.includes("/database/query")) return Response.json([{ schemas: 3 }]);
      if (url.includes("api.vercel.com/v9/projects")) return new Response("no", { status: 404 });
      return Response.json({});
    });
    const result = await runProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env: { UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t", UNITOS_VERCEL_TOKEN: "v", UNITOS_GITHUB_TOKEN: "g" },
      fetchImpl: fetchImpl as never,
    });
    expect(result.result).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("não ligado");
  });

  it("FAIL quando o baseline falha no destino", async () => {
    const { api } = fakeClient();
    let queries = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      const gh = githubResponse(url);
      if (gh) return gh;
      if (url.includes("/api-keys")) {
        return Response.json([
          { name: "anon", api_key: "k" },
          { name: "service_role", api_key: "s" },
        ]);
      }
      if (url.includes("/database/query")) {
        queries += 1;
        if (queries === 1) return Response.json([{ schemas: 3 }]);
        return new Response("erro de sintaxe", { status: 400 });
      }
      return Response.json({});
    });
    const result = await runProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env: { UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t", UNITOS_VERCEL_TOKEN: "v", UNITOS_GITHUB_TOKEN: "g" },
      fetchImpl: fetchImpl as never,
    });
    expect(result.result).toBe("FAIL");
  });

  it("aplica todo baseline em lotes curtos, sem enviar arquivo integral", async () => {
    const { applyStatementByStatement } = await import("@/lib/installation/automation.server");
    const sizes: number[] = [];
    const sql = Array.from({ length: 57 }, (_, index) => `SELECT ${index};`).join("\n");
    const result = await applyStatementByStatement(
      { query: async (batch) => { sizes.push((batch.match(/DO \$unitos_guard\$/g) ?? []).length); return { ok: true, rows: [] }; } },
      sql,
    );
    expect(result).toEqual({
      ok: true,
      skipped: 0,
      processed: 25,
      total: 57,
      complete: false,
    });
    expect(sizes).toEqual([25]);
  });

  it("retoma a fatia seguinte e conclui sem reaplicar statements", async () => {
    const { applyStatementByStatement } = await import("@/lib/installation/automation.server");
    const sizes: number[] = [];
    const sql = Array.from({ length: 57 }, (_, index) => `SELECT ${index};`).join("\n");
    const management = {
      query: async (batch: string) => {
        sizes.push((batch.match(/DO \$unitos_guard\$/g) ?? []).length);
        return { ok: true, rows: [] };
      },
    };
    const second = await applyStatementByStatement(management, sql, { startIndex: 25 });
    const third = await applyStatementByStatement(management, sql, { startIndex: 50 });
    expect(second).toMatchObject({ processed: 50, total: 57, complete: false });
    expect(third).toMatchObject({ processed: 57, total: 57, complete: true });
    expect(sizes).toEqual([25, 7]);
  });

  it("retomada NÃO regera secrets nem republica quando a fase de deploy já concluiu", async () => {
    const { api } = fakeClient({
      stageProgress: {
        deployDone: true,
        appUrl: "https://unitos-pitada-abc.vercel.app",
        urlSource: "deploy",
        frontendOk: true,
        codeDone: true,
        codeSha: "sha_master",
      },
    });
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      const gh = githubResponse(url);
      if (gh) return gh;
      calls.push(url);
      if (url.includes("/api-keys")) {
        return Response.json([
          { name: "anon", api_key: "sb_publishable_x" },
          { name: "service_role", api_key: "sb_secret_x" },
        ]);
      }
      if (url.includes("/database/query")) return Response.json([{ schemas: 3, item: "ok" }]);
      return new Response("{}", { status: 200 });
    });

    const result = await runProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env: { UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t", UNITOS_VERCEL_TOKEN: "v", UNITOS_GITHUB_TOKEN: "g" },
      fetchImpl: fetchImpl as never,
    });

    expect(result.result).toBe("PASS");
    expect(result.appUrl).toBe("https://unitos-pitada-abc.vercel.app");
    // Nenhuma variável reescrita, nenhum redeploy repetido, nenhum secret novo.
    expect(calls.some((c) => c.includes("/env"))).toBe(false);
    expect(calls.some((c) => c.includes("v13/deployments"))).toBe(false);
    expect(calls.some((c) => c.includes("set_cron_secret"))).toBe(false);
  });

  it("recusa instalação apontada para o MASTER", async () => {
    const { api } = fakeClient();
    const result = await runProvision({
      client: api,
      operation: OP,
      installation: { ...INSTALLATION, supabaseUrl: `https://${MASTER_REF}.supabase.co`, supabaseProjectRef: MASTER_REF },
      env: { UNITOS_SUPABASE_MANAGEMENT_TOKEN: "t", UNITOS_VERCEL_TOKEN: "v", UNITOS_GITHUB_TOKEN: "g" },
      fetchImpl: (async () => new Response("{}")) as never,
    });
    expect(result.result).toBe("BLOCKED");
  });
});

describe("clientes de gestão", () => {
  it("management client reporta erro sem expor o token", async () => {
    const client = createManagementClient({
      token: "super-secreto",
      projectRef: "abcdefghijklmnop",
      fetchImpl: (async () => new Response("boom", { status: 500 })) as never,
    });
    const result = await client.query("select 1");
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("super-secreto");
  });

  it("deploy client grava variáveis com upsert", async () => {
    const seen: string[] = [];
    const client = createDeployClient({
      token: "t",
      project: "p",
      fetchImpl: (async (url: string) => {
        seen.push(url);
        return Response.json({});
      }) as never,
    });
    const result = await client.setEnv([{ key: "PUBLIC_APP_URL", value: "https://x.vercel.app", sensitive: false }]);
    expect(result.ok).toBe(true);
    expect(seen[0]).toContain("upsert=true");
  });
});
