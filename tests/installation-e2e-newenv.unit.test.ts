/**
 * Ensaio PONTA A PONTA de uma instalação nova (ambiente novo), sem rede real.
 *
 * Cada cenário representa um ponto que já quebrou em produção: acesso
 * insuficiente, indisponibilidade momentânea, repositório criado por template,
 * chaves informadas à mão e validação final reprovada. O objetivo é garantir
 * que o fluxo nunca declare sucesso sem ter concluído todas as etapas e que
 * nenhuma operação fique presa "em andamento".
 */
import { describe, expect, it, vi } from "vitest";

import {
  createCodeClient,
  createManagementClient,
  runAutomatedProvision,
  withRepoWriteHint,
} from "@/lib/installation/automation.server";
import { PROVISION_STEPS } from "@/lib/installation/manager-contract";

type Call = { url: string; method: string; body: string };

function fakeClient() {
  const updates: Record<string, unknown>[] = [];
  const api = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { status: "running", steps: [], detail: {} } }),
        }),
      }),
      upsert: async (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { error: null };
      },
    }),
  };
  return { api, updates };
}

const OP = {
  id: "00000000-0000-0000-0000-0000000000e1",
  installation_id: "00000000-0000-0000-0000-0000000000e2",
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
  supabaseUrl: "https://novoambientenovo1.supabase.co",
  supabaseProjectRef: "novoambientenovo1",
  deployProject: "unitos-novo",
  gitRepoUrl: "https://github.com/mahara-apps/unitos-novo",
};

const MASTER_ENV = {
  UNITOS_SUPABASE_MANAGEMENT_TOKEN: "sbp_token",
  UNITOS_VERCEL_TOKEN: "vercel_token",
  UNITOS_GITHUB_TOKEN: "gh_token",
};

const VERIFY_MARK = "isolamento: banco próprio";

/** Servidor simulado de GitHub + Vercel + Supabase Management. */
function scenario(
  overrides: {
    keysStatus?: number;
    queryStatus?: (body: string) => number | null;
    githubDestStatus?: number;
    verifyRows?: unknown[];
    suppliedKeys?: boolean;
  } = {},
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? String(init.body) : "";
    calls.push({ url: u, method: init?.method ?? "GET", body });

    if (u.includes("api.github.com")) {
      if (u.endsWith("/repos/mahara-apps/unitos-master")) {
        return Response.json({ is_template: true });
      }
      if (u.includes("/contents/supabase/baseline-snapshot/tools/delta_version.txt")) {
        return Response.json({
          encoding: "base64",
          content: Buffer.from("version=9.9.9\n", "utf8").toString("base64"),
        });
      }
      if (overrides.githubDestStatus && u.includes("unitos-novo")) {
        return new Response(
          JSON.stringify({ message: "Resource not accessible by personal access token" }),
          { status: overrides.githubDestStatus },
        );
      }
      if (u.includes("/generate")) return Response.json({ full_name: "mahara-apps/unitos-novo" });
      if (u.includes("/git/trees")) return Response.json({ tree: [] });
      if (u.includes("/git/ref/heads/")) return Response.json({ object: { sha: "sha_dest" } });
      if (u.includes("/commits/main")) return Response.json({ sha: "sha_master" });
      if (u.includes("/git/blobs")) {
        return Response.json({ sha: "blob_1", content: "", encoding: "base64" });
      }
      if (u.includes("/git/commits")) return Response.json({ sha: "commit_1" });
      if (u.includes("/git/refs")) return Response.json({ ok: true });
      return Response.json({ full_name: "mahara-apps/unitos-novo" });
    }

    if (u.includes("/api-keys")) {
      if (overrides.keysStatus && overrides.keysStatus >= 400) {
        return new Response(
          JSON.stringify({ message: "Your account does not have the necessary privileges" }),
          { status: overrides.keysStatus },
        );
      }
      return Response.json([
        { name: "anon", api_key: "sb_publishable_novo" },
        { name: "service_role", api_key: "sb_secret_novo" },
      ]);
    }

    if (u.includes("/database/query")) {
      const forced = overrides.queryStatus?.(body) ?? null;
      if (forced && forced >= 400) {
        return new Response(JSON.stringify({ message: "sem privilégio" }), { status: forced });
      }
      if (body.includes(VERIFY_MARK) && overrides.verifyRows) {
        return Response.json(overrides.verifyRows);
      }
      return Response.json([{ schemas: 3, item: "ok", status: "PASS" }]);
    }

    if (u.includes("api.vercel.com/v9/projects")) {
      return Response.json({
        name: "unitos-novo",
        link: {
          type: "github",
          org: "mahara-apps",
          repo: "unitos-novo",
          repoId: 101,
          productionBranch: "main",
        },
        targets: { production: { url: "unitos-novo-abc.vercel.app" } },
      });
    }
    if (u.includes("/env")) return Response.json({ created: [] });
    if (u.includes("api.vercel.com/v6/deployments")) {
      return Response.json({ deployments: [{ uid: "dpl_prev", name: "unitos-novo" }] });
    }
    if (u.includes("api.vercel.com/v13/deployments")) return Response.json({ id: "dpl_new" });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const env = overrides.suppliedKeys
    ? {
        ...MASTER_ENV,
        UNITOS_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_manual",
        UNITOS_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_manual",
      }
    : MASTER_ENV;

  const { api, updates } = fakeClient();
  const run = () =>
    runAutomatedProvision({
      client: api,
      operation: OP,
      installation: INSTALLATION,
      env,
      fetchImpl: fetchImpl as never,
      maxStatementsPerInvocation: Number.POSITIVE_INFINITY,
    });

  return { run, calls, updates };
}

const dbWrites = (calls: Call[]) =>
  calls.filter(
    (c) =>
      c.url.includes("/database/query") &&
      /create table|alter table|insert into/i.test(c.body) &&
      !c.body.includes(VERIFY_MARK),
  );

describe("instalação de ambiente novo — ponta a ponta", () => {
  it("caminho completo: todas as etapas concluídas, URL publicada e validação final aprovada", async () => {
    const { run, calls } = scenario();
    const result = await run();

    expect(result.result).toBe("PASS");
    expect(result.appUrl).toBe("https://unitos-novo-abc.vercel.app");
    expect(result.steps.every((s) => s.state === "done")).toBe(true);

    // Nenhuma etapa do contrato pode faltar no relatório final.
    const reported = new Set(result.steps.map((s) => s.id));
    for (const step of PROVISION_STEPS) expect(reported.has(step.id)).toBe(true);

    // A validação final rodou de verdade contra o banco do destino.
    expect(calls.some((c) => c.body.includes(VERIFY_MARK))).toBe(true);
  });

  it("validação final reprovada nunca vira sucesso", async () => {
    const { run } = scenario({
      verifyRows: [
        { check_name: "RLS habilitado", observed: "3 tabelas", status: "FAIL" },
        { check_name: "seeds de catálogo", observed: "ok", status: "PASS" },
      ],
    });
    const result = await run();

    expect(result.result).not.toBe("PASS");
    expect(result.reasons.join(" ")).toMatch(/verify-installation|RLS/i);
  });

  it("acesso insuficiente no Supabase interrompe antes de tocar no banco", async () => {
    const { run, calls } = scenario({
      queryStatus: (body) => (body.includes("schemas") ? 403 : null),
    });
    const result = await run();

    expect(result.result).toBe("BLOCKED");
    expect(result.reasons.join(" ")).toContain("Supabase destino");
    expect(dbWrites(calls)).toHaveLength(0);
  });

  it("chaves não reveláveis pelo token são supridas pelas chaves informadas à mão", async () => {
    const blocked = await scenario({ keysStatus: 403 }).run();
    expect(blocked.result).toBe("BLOCKED");
    expect(blocked.reasons.join(" ")).toContain("chaves");

    const supplied = await scenario({ keysStatus: 403, suppliedKeys: true }).run();
    expect(supplied.result).toBe("PASS");
  });

  it("token sem gravação no repositório da instalação dá motivo acionável e não publica", async () => {
    const { run, calls } = scenario({ githubDestStatus: 403 });
    const result = await run();

    expect(result.result).not.toBe("PASS");
    expect(result.reasons.join(" ").length).toBeGreaterThan(10);
    // Falhou no código: nada de publicar deployment novo depois disso.
    expect(calls.some((c) => c.url.includes("v13/deployments"))).toBe(false);
  });

  it("indisponibilidade momentânea do Supabase é tratada como temporária, com nova tentativa", async () => {
    let attempts = 0;
    const fetchImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) return new Response("error code: 502", { status: 502 });
      return Response.json([{ schemas: 3 }]);
    }) as unknown as typeof fetch;

    const management = createManagementClient({
      token: "sbp_token",
      projectRef: "novoambientenovo1",
      fetchImpl: fetchImpl as never,
    });
    const ping = await management.query("select 1 as schemas");

    expect(ping.ok).toBe(true);
    expect(attempts).toBeGreaterThan(1);
  });

  it("qualquer desfecho fecha a operação — nada permanece em andamento", async () => {
    for (const s of [scenario(), scenario({ githubDestStatus: 403 })]) {
      const { run, updates } = s;
      await run();
      const finals = updates.filter(
        (u) => typeof u["status"] === "string" && u["status"] !== "running",
      );
      expect(finals.length).toBeGreaterThan(0);
      expect(finals.some((u) => u["finished_at"])).toBe(true);
    }
  });
});

describe("permissão de gravação no repositório", () => {
  it("traduz o 403 do GitHub na permissão exata que falta", () => {
    const hint = withRepoWriteHint(
      'HTTP 403 ao publicar arquivo ({"message":"Resource not accessible by personal access token"})',
      "mahara-apps/unitos-casa8",
    );
    expect(hint).toContain("Contents: Read and write");
    expect(hint).toContain("mahara-apps/unitos-casa8");
  });

  it("não altera mensagens que não são de permissão", () => {
    expect(withRepoWriteHint("HTTP 502 instabilidade", "a/b")).toBe("HTTP 502 instabilidade");
  });

  it("o teste de acesso comprova a gravação escrevendo de verdade", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.includes("/rate_limit")) {
        return Response.json({ resources: { core: { remaining: 4999, limit: 5000 } } });
      }
      if (u.endsWith("/user")) return Response.json({ login: "mahara-apps" });
      if (u.includes("/git/blobs")) {
        return new Response(
          JSON.stringify({ message: "Resource not accessible by personal access token" }),
          { status: 403 },
        );
      }
      // metadados do repositório mentem: dizem que há push
      return Response.json({ permissions: { push: true }, is_template: true });
    }) as unknown as typeof fetch;

    const code = createCodeClient({
      token: "gh_token",
      masterToken: "gh_master",
      owner: "mahara-apps",
      repo: "unitos-casa8",
      masterRepo: "mahara-apps/unitos-master",
      fetchImpl: fetchImpl as never,
    });
    const checks = await code.permissions();
    const write = checks.find((c) => /Gravação no repositório/i.test(c.label));

    expect(calls.some((c) => c.startsWith("POST") && c.includes("/git/blobs"))).toBe(true);
    expect(write?.ok).toBe(false);
    expect(write?.detail).toContain("Contents: Read and write");
  });
});
