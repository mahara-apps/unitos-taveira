import { describe, expect, it, vi } from "vitest";

import { resolveInstallationRepo } from "@/lib/installation/automation-contract";
import { createCodeClient, DEFAULT_MASTER_REPO } from "@/lib/installation/automation.server";

describe("repositório da instalação", () => {
  it("extrai owner/repo de várias formas de URL", () => {
    for (const url of [
      "https://github.com/acme/unitos-pitada",
      "https://github.com/acme/unitos-pitada.git",
      "git@github.com:acme/unitos-pitada.git",
      "github.com/acme/unitos-pitada/",
    ]) {
      expect(resolveInstallationRepo({ gitRepoUrl: url })).toMatchObject({
        ok: true,
        owner: "acme",
        repo: "unitos-pitada",
        slug: "acme/unitos-pitada",
      });
    }
  });

  it("exige repositório e recusa formato inválido", () => {
    expect(resolveInstallationRepo({ gitRepoUrl: "" }).ok).toBe(false);
    expect(resolveInstallationRepo({ gitRepoUrl: "https://github.com/acme" }).ok).toBe(false);
  });

  it("recusa o MASTER como destino (por domínio e por slug)", () => {
    expect(resolveInstallationRepo({ gitRepoUrl: "https://unitos-master.lovable.app/x/y" }).ok).toBe(
      false,
    );
    expect(
      resolveInstallationRepo({
        gitRepoUrl: `https://github.com/${DEFAULT_MASTER_REPO}`,
        masterRepo: DEFAULT_MASTER_REPO,
      }).ok,
    ).toBe(false);
  });
});

const client = (fetchImpl: unknown) =>
  createCodeClient({
    token: "gh",
    owner: "acme",
    repo: "unitos-pitada",
    masterRepo: "mahara-apps/unitos-master",
    fetchImpl: fetchImpl as never,
  });

describe("createCodeClient", () => {
  it("cria o repositório a partir do template quando ele não existe", async () => {
    const calls: string[] = [];
    const c = client(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/repos/acme/unitos-pitada")) return new Response("no", { status: 404 });
      return Response.json({ full_name: "acme/unitos-pitada" });
    });
    const res = await c.ensureRepo();
    expect(res).toEqual({ ok: true, created: true, via: "template" });
    expect(calls.some((c2) => c2.includes("/generate"))).toBe(true);
  });

  it("é idempotente quando o repositório já existe", async () => {
    const calls: string[] = [];
    const c = client(async (url: string) => {
      calls.push(url);
      return Response.json({ full_name: "acme/unitos-pitada" });
    });
    expect(await c.ensureRepo()).toEqual({ ok: true, created: false, via: "existing" });
    expect(calls.some((c2) => c2.includes("/generate"))).toBe(false);
  });

  it("publica só o que difere e cria um commit por cima da branch", async () => {
    const posted: string[] = [];
    const c = client(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") posted.push(`${method} ${url}`);
      if (url.includes("/repos/mahara-apps/unitos-master/git/trees")) {
        return Response.json({
          tree: [
            { path: "a.ts", type: "blob", mode: "100644", sha: "s1" },
            { path: "b.ts", type: "blob", mode: "100644", sha: "s2" },
          ],
        });
      }
      if (url.includes("/repos/acme/unitos-pitada/git/trees/")) {
        return Response.json({
          tree: [
            { path: "a.ts", type: "blob", mode: "100644", sha: "s1" },
            { path: "antigo.ts", type: "blob", mode: "100644", sha: "s9" },
          ],
        });
      }
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "dest" } });
      if (url.includes("/git/blobs/")) return Response.json({ content: "eA==", encoding: "base64" });
      if (url.includes("/git/blobs")) return Response.json({ sha: "novo" });
      if (url.includes("/git/trees")) return Response.json({ sha: "tree_new" });
      if (url.includes("/git/commits")) return Response.json({ sha: "commit_new" });
      return Response.json({ ok: true });
    });
    const res = await c.publishSnapshot("master_sha");
    expect(res.ok).toBe(true);
    expect(res.commitSha).toBe("commit_new");
    // b.ts (novo) + antigo.ts (removido) = 2; a.ts idêntico não é recopiado.
    expect(res.changed).toBe(2);
    // Objetos compartilhados: o SHA do MASTER é referenciado direto, sem
    // recriar blob no destino.
    expect(posted.filter((p) => p.includes("/git/blobs")).length).toBe(0);
  });

  it("não gera commit quando o repositório já está na versão do MASTER", async () => {
    const posted: string[] = [];
    const c = client(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") !== "GET") posted.push(url);
      if (url.includes("/git/trees")) {
        return Response.json({ tree: [{ path: "a.ts", type: "blob", mode: "100644", sha: "s1" }] });
      }
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "dest" } });
      return Response.json({});
    });
    const res = await c.publishSnapshot("master_sha");
    expect(res).toEqual({ ok: true, commitSha: "dest", changed: 0 });
    expect(posted).toEqual([]);
  });

  it("erro do GitHub nunca vira sucesso", async () => {
    const c = client(vi.fn(async () => new Response("rate limit", { status: 403 })));
    const res = await c.publishSnapshot("master_sha");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("403");
  });
});

describe("publicação em repositório sem objetos compartilhados", () => {
  /** MASTER com N arquivos; destino vazio; blobs do MASTER inacessíveis no destino. */
  const scenario = (files: number) => {
    const posted: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") posted.push(`${method} ${url}`);
      if (url.includes("/repos/mahara-apps/unitos-master/git/trees")) {
        return Response.json({
          tree: Array.from({ length: files }, (_, i) => ({
            path: `f${i}.ts`,
            type: "blob",
            mode: "100644",
            sha: `s${i}`,
          })),
        });
      }
      if (url.includes("/repos/acme/unitos-pitada/git/trees/")) return Response.json({ tree: [] });
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "dest" } });
      // Probe de objeto compartilhado e leitura no destino falham.
      if (url.includes("/repos/acme/unitos-pitada/git/blobs/")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/repos/mahara-apps/unitos-master/git/blobs/")) {
        return Response.json({ content: "eA==", encoding: "base64" });
      }
      if (url.includes("/git/blobs")) return Response.json({ sha: `d-${posted.length}` });
      if (url.includes("/git/trees")) return Response.json({ sha: "tree_new" });
      if (url.includes("/git/commits")) return Response.json({ sha: "commit_new" });
      return Response.json({ ok: true });
    };
    return { posted, client: client(fetchImpl) };
  };

  it("copia blobs, persiste checkpoint e não recopia na retomada", async () => {
    const first = scenario(3);
    let saved: Record<string, string> = {};
    const res = await first.client.publishSnapshot("master_sha", {
      onCheckpoint: (map) => {
        saved = map;
      },
    });
    expect(res.ok).toBe(true);
    expect(res.commitSha).toBe("commit_new");
    expect(Object.keys(saved)).toHaveLength(3);

    const second = scenario(3);
    const again = await second.client.publishSnapshot("master_sha", { blobMap: saved });
    expect(again.ok).toBe(true);
    // Nada é recopiado: nenhum POST de blob na segunda rodada.
    expect(second.posted.filter((p) => p.includes("POST") && p.endsWith("/git/blobs"))).toHaveLength(
      0,
    );
  });

  it("devolve `partial` ao esgotar o orçamento de tempo, sem commitar", async () => {
    const many = scenario(250);
    const res = await many.client.publishSnapshot("master_sha", { timeBudgetMs: 1 });
    expect(res.ok).toBe(true);
    expect(res.partial).toBe(true);
    expect(many.posted.some((p) => p.includes("/git/commits"))).toBe(false);
  });

  it("modo conferência não escreve nada e informa quantos arquivos diferem", async () => {
    const dry = scenario(4);
    const res = await dry.client.publishSnapshot("master_sha", { dryRun: true });
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(4);
    expect(dry.posted).toHaveLength(0);
  });
});

describe("objetos do MASTER apenas parcialmente disponíveis", () => {
  it("recua para cópia de blobs quando a árvore compartilhada é recusada (422)", async () => {
    const posted: string[] = [];
    let treeAttempts = 0;
    const c = createCodeClient({
      token: "gh",
      owner: "acme",
      repo: "unitos-pitada",
      masterRepo: "mahara-apps/unitos-master",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        if (method !== "GET") posted.push(`${method} ${url}`);
        if (url.includes("/repos/mahara-apps/unitos-master/git/trees")) {
          return Response.json({
            tree: [{ path: "a.ts", type: "blob", mode: "100644", sha: "s1" }],
          });
        }
        if (url.includes("/repos/acme/unitos-pitada/git/trees/")) return Response.json({ tree: [] });
        if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "dest" } });
        // Probe passa (objeto existe), mas a árvore é recusada.
        if (url.includes("/repos/acme/unitos-pitada/git/blobs/")) return Response.json({ sha: "s1" });
        if (url.includes("/repos/mahara-apps/unitos-master/git/blobs/")) {
          return Response.json({ content: "eA==", encoding: "base64" });
        }
        if (url.endsWith("/git/blobs")) return Response.json({ sha: "copiado" });
        if (url.endsWith("/git/trees")) {
          treeAttempts += 1;
          if (treeAttempts === 1) {
            return new Response(JSON.stringify({ message: "tree.sha s1 is not a valid blob" }), {
              status: 422,
            });
          }
          return Response.json({ sha: "tree_new" });
        }
        if (url.includes("/git/commits")) return Response.json({ sha: "commit_new" });
        return Response.json({ ok: true });
      }) as never,
    });
    const res = await c.publishSnapshot("master_sha");
    expect(res.ok).toBe(true);
    expect(res.commitSha).toBe("commit_new");
    expect(treeAttempts).toBe(2);
    expect(posted.some((p) => p.includes("POST") && p.endsWith("/git/blobs"))).toBe(true);
  });
});
