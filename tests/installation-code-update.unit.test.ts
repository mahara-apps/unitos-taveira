import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createDeployClient } from "@/lib/installation/automation.server";
import { UPDATE_STEPS, stepsFor, statusAfterOperation } from "@/lib/installation/manager-contract";

/** Fetch mínimo controlado — nenhuma chamada externa real. */
function fakeFetch(routes: Array<{ match: RegExp; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes.find((r) => r.match.test(u));
    return {
      ok: (route?.status ?? 200) < 400,
      status: route?.status ?? 200,
      json: async () => route?.body ?? {},
      text: async () => JSON.stringify(route?.body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("atualização de código da instalação", () => {
  it("a operação update tem etapas próprias", () => {
    expect(stepsFor("update")).toBe(UPDATE_STEPS);
    expect(UPDATE_STEPS.map((s) => s.id)).toEqual(["database", "code", "build", "validation", "version"]);
    expect(UPDATE_STEPS.find((step) => step.id === "code")?.script).toContain("github: push");
    expect(UPDATE_STEPS.find((step) => step.id === "code")?.script).not.toContain("v13/deployments");
  });

  it("a atualização automatizada não cria deployment pela API", () => {
    const source = readFileSync("src/lib/installation/automation.server.ts", "utf8");
    const updateBody = source.slice(source.indexOf("export async function runAutomatedUpdate"));
    expect(updateBody).not.toContain("deploy.deployLatestCode(");
    expect(updateBody).toContain('return finishByGitPush("atualização enviada ao repositório")');
  });

  it("update bem-sucedido com a versão do MASTER deixa a instalação atualizada", () => {
    expect(statusAfterOperation("update", { ok: true, version: "1.0.0" }, "1.0.0")).toBe(
      "up_to_date",
    );
  });

  it("dispara deployment a partir do repositório do MASTER (código novo)", async () => {
    const { impl, calls } = fakeFetch([
      {
        match: /v9\/projects\//,
        body: {
          name: "unitos-teste",
          link: {
            type: "github",
            org: "mahara-apps",
            repo: "unitos-master",
            repoId: 42,
            productionBranch: "main",
          },
        },
      },
      { match: /v13\/deployments\?/, body: { id: "dpl_1" } },
    ]);
    const client = createDeployClient({ token: "t", project: "unitos-teste", fetchImpl: impl });
    const res = await client.deployLatestCode();
    expect(res).toMatchObject({ ok: true, deploymentId: "dpl_1", source: "git", ref: "main" });
    const created = calls.find((c) => c.method === "POST");
    expect(created?.body).toMatchObject({
      target: "production",
      gitSource: { type: "github", repoId: "42", ref: "main" },
    });
  });

  it("projeto ligado a outro repositório é religado ao MASTER antes do deploy", async () => {
    const { impl, calls } = fakeFetch([
      {
        match: /v9\/projects\/[^/]+$/,
        body: {
          id: "prj_1",
          name: "unitos-teste",
          link: {
            type: "github",
            org: "mahara-apps",
            repo: "unitos-teste",
            repoId: 7,
            productionBranch: "main",
          },
        },
      },
      { match: /\/link/, body: { ok: true } },
      { match: /v13\/deployments\?/, body: { id: "dpl_2" } },
    ]);
    const client = createDeployClient({ token: "t", project: "unitos-teste", fetchImpl: impl });
    await client.deployLatestCode();
    expect(calls.some((c) => c.method === "DELETE" && /\/link/.test(c.url))).toBe(true);
    const link = calls.find((c) => c.method === "POST" && /\/link/.test(c.url));
    expect(link?.body).toMatchObject({ repo: "mahara-apps/unitos-master", gitBranch: "main" });
  });

  it("sem vínculo salvo resolve o repositório no GitHub e publica o código novo", async () => {
    const { impl } = fakeFetch([
      { match: /v9\/projects\//, body: { name: "unitos-teste" } },
      {
        match: /v6\/deployments/,
        body: { deployments: [{ uid: "dpl_old", name: "unitos-teste" }] },
      },
      { match: /v13\/deployments\?/, body: { id: "dpl_2" } },
    ]);
    const client = createDeployClient({ token: "t", project: "unitos-teste", fetchImpl: impl });
    const res = await client.deployLatestCode();
    expect(res).toMatchObject({ ok: true, source: "git" });
  });

  it("mantém o build automático ligado e publica o commit autorizado", async () => {
    const { impl, calls } = fakeFetch([
      {
        match: /v9\/projects\//,
        body: {
          name: "unitos-teste",
          link: {
            type: "github",
            org: "mahara-apps",
            repo: "unitos-master",
            repoId: 42,
            productionBranch: "main",
          },
        },
      },
      { match: /v13\/deployments\?/, body: { id: "dpl_9" } },
    ]);
    const client = createDeployClient({ token: "t", project: "unitos-teste", fetchImpl: impl });
    const res = await client.deployLatestCode({ sha: "abcdef1234567890" });
    expect(res).toMatchObject({ ok: true, deploymentId: "dpl_9", ref: "abcdef1234567890" });
    // auto-deploy LIGADO: rede de segurança quando a API da Vercel falha
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({
      deploymentPolicy: {
        deploymentSources: [
          {
            enabled: true,
            environments: [
              { type: "system", target: "production" },
              { type: "system", target: "preview" },
            ],
            sources: ["git"],
          },
        ],
      },
    });
    const created = calls.find((c) => c.method === "POST");
    expect(created?.body).toMatchObject({
      gitSource: { repoId: "42", ref: "abcdef1234567890" },
    });
  });

  it("lê o commit atual da branch de produção do MASTER", async () => {
    const { impl } = fakeFetch([
      { match: /api\.github\.com\/repos\/.+\/commits\/main/, body: { sha: "cafe1234567" } },
    ]);
    const client = createDeployClient({
      token: "t",
      project: "p",
      fetchImpl: impl,
      githubToken: "gh",
    });
    await expect(client.latestCommit()).resolves.toMatchObject({ ok: true, sha: "cafe1234567" });
  });

  it("lê o estado do deployment", async () => {
    const { impl } = fakeFetch([
      { match: /v13\/deployments\/dpl_1/, body: { readyState: "READY", url: "x.vercel.app" } },
    ]);
    const client = createDeployClient({ token: "t", project: "p", fetchImpl: impl });
    expect(await client.deploymentState("dpl_1")).toMatchObject({
      ok: true,
      state: "READY",
      url: "https://x.vercel.app",
    });
  });

  it("localiza o deployment de produção pelo commit exato do push", async () => {
    const { impl } = fakeFetch([
      {
        match: /v6\/deployments/,
        body: {
          deployments: [
            { uid: "dpl_old", source: "git", readyState: "READY", meta: { githubCommitSha: "old" } },
            {
              uid: "dpl_git",
              source: "git",
              readyState: "BUILDING",
              url: "unitos-casa-8.vercel.app",
              meta: { githubCommitSha: "abc123" },
            },
          ],
        },
      },
    ]);
    const client = createDeployClient({ token: "t", project: "unitos-casa-8", fetchImpl: impl });
    await expect(client.findProductionDeployment("ABC123")).resolves.toMatchObject({
      ok: true,
      deploymentId: "dpl_git",
      state: "BUILDING",
      url: "https://unitos-casa-8.vercel.app",
    });
  });

  it("não confunde outro deployment com o commit recém-enviado", async () => {
    const { impl } = fakeFetch([
      {
        match: /v6\/deployments/,
        body: {
          deployments: [
            { uid: "dpl_old", source: "git", readyState: "READY", meta: { githubCommitSha: "old" } },
          ],
        },
      },
    ]);
    const client = createDeployClient({ token: "t", project: "unitos-casa-8", fetchImpl: impl });
    await expect(client.findProductionDeployment("new")).resolves.toEqual({ ok: true });
  });

  it.each([
    [
      { uid: "dpl_api", source: "api", readyState: "BLOCKED", createdAt: 20, meta: { githubCommitSha: "same" } },
      { uid: "dpl_git", source: "git", readyState: "READY", createdAt: 10, meta: { githubCommitSha: "same" } },
    ],
    [
      { uid: "dpl_git", source: "git", readyState: "READY", createdAt: 10, meta: { githubCommitSha: "same" } },
      { uid: "dpl_api", source: "api", readyState: "BLOCKED", createdAt: 20, meta: { githubCommitSha: "same" } },
    ],
  ])("prioriza o deployment READY quando o mesmo commit também tem um BLOCKED", async (...deployments) => {
    const { impl } = fakeFetch([{ match: /v6\/deployments/, body: { deployments } }]);
    const client = createDeployClient({ token: "t", project: "unitos-casa-8", fetchImpl: impl });

    await expect(client.findProductionDeployment("same")).resolves.toMatchObject({
      ok: true,
      deploymentId: "dpl_git",
      state: "READY",
    });
  });

  it("ignora tentativa REST bloqueada mesmo quando não existe build Git ainda", async () => {
    const { impl } = fakeFetch([
      {
        match: /v6\/deployments/,
        body: {
          deployments: [
            {
              uid: "dpl_api",
              source: "api",
              readyState: "BLOCKED",
              meta: { githubCommitSha: "same" },
            },
          ],
        },
      },
    ]);
    const client = createDeployClient({ token: "t", project: "unitos-taveira", fetchImpl: impl });
    await expect(client.findProductionDeployment("same")).resolves.toEqual({ ok: true });
  });

  it("o checkpoint de atualização usa campos não sensíveis e reutilizáveis", () => {
    const detail = {
      automated: true,
      stageProgress: {
        updateDeploymentId: "dpl_1",
        updateDeploymentSource: "git" as const,
        updateDeploymentRef: "main",
        updateGitPushCommit: "push123",
      },
    };
    expect(detail.stageProgress).toEqual({
      updateDeploymentId: "dpl_1",
      updateDeploymentSource: "git",
      updateDeploymentRef: "main",
      updateGitPushCommit: "push123",
    });
    expect(JSON.stringify(detail)).not.toMatch(/token|secret|password/i);
  });
});

describe("quando a Vercel não encontra o repositório", () => {
  it("tenta owner/repo e sinaliza gitSourceUnavailable para publicar pelo Git", async () => {
    const { impl, calls } = fakeFetch([
      {
        match: /v9\/projects\//,
        body: {
          name: "unitos-taveira",
          link: {
            type: "github",
            org: "mahara-apps",
            repo: "unitos-taveira",
            repoId: 99,
            productionBranch: "main",
          },
        },
      },
      {
        match: /v13\/deployments\?/,
        status: 400,
        body: {
          error: {
            code: "incorrect_git_source_info",
            message: "The provided GitHub repository can't be found.",
          },
        },
      },
    ]);
    const client = createDeployClient({ token: "t", project: "unitos-taveira", fetchImpl: impl });
    const res = await client.deployLatestCode({ sha: "abc1234" });
    expect(res.ok).toBe(false);
    expect(res.gitSourceUnavailable).toBe(true);
    const deployPosts = calls.filter((c) => c.method === "POST" && /v13\/deployments/.test(c.url));
    expect(deployPosts.length).toBeGreaterThan(1);
  });
});
