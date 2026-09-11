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
    expect(
      resolveInstallationRepo({ gitRepoUrl: "https://unitos-master.lovable.app/x/y" }).ok,
    ).toBe(false);
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
      if (url.endsWith("/repos/mahara-apps/unitos-master"))
        return Response.json({ is_template: true });
      if (url.endsWith("/repos/acme/unitos-pitada/commits/main"))
        return Response.json({ sha: "generated_commit" });
      return Response.json({ full_name: "acme/unitos-pitada" });
    });
    const res = await c.ensureRepo();
    expect(res).toEqual({
      ok: true,
      created: true,
      via: "template",
      commitSha: "generated_commit",
    });
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

  it("não cria fork nem repositório vazio quando o template falha", async () => {
    const calls: string[] = [];
    const c = client(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/repos/acme/unitos-pitada")) return new Response("no", { status: 404 });
      if (url.endsWith("/repos/mahara-apps/unitos-master"))
        return Response.json({ is_template: true });
      if (url.endsWith("/generate")) return new Response("forbidden", { status: 403 });
      return Response.json({});
    });
    const result = await c.ensureRepo({ initialProvision: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Nenhum repositório vazio foi criado");
    expect(calls.some((call) => call.includes("/forks"))).toBe(false);
    expect(calls.some((call) => call.includes("/orgs/acme/repos"))).toBe(false);
  });

  it("recupera o README técnico por backup arquivado, sem excluir o repositório", async () => {
    const calls: string[] = [];
    let originalExists = true;
    const seed = Buffer.from(
      "# unitos-pitada\n\nInstalação Unitos. Código publicado a partir do MASTER.\n",
    ).toString("base64");
    const c = client(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.endsWith("/repos/acme/unitos-pitada") && method === "PATCH") {
        originalExists = false;
        return Response.json({ name: "unitos-pitada-legacy-readme" });
      }
      if (url.endsWith("/repos/acme/unitos-pitada")) {
        return originalExists
          ? Response.json({ full_name: "acme/unitos-pitada" })
          : new Response("no", { status: 404 });
      }
      if (url.endsWith("/repos/acme/unitos-pitada-legacy-readme") && method === "GET")
        return new Response("no", { status: 404 });
      if (url.endsWith("/repos/acme/unitos-pitada-legacy-readme") && method === "PATCH")
        return Response.json({ archived: true });
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "seed" } });
      if (url.includes("/git/trees/seed"))
        return Response.json({ tree: [{ path: "README.md", type: "blob", sha: "readme" }] });
      if (url.includes("/contents/README.md"))
        return Response.json({ encoding: "base64", content: seed });
      if (url.endsWith("/repos/mahara-apps/unitos-master"))
        return Response.json({ is_template: true });
      if (url.endsWith("/generate")) return Response.json({ full_name: "acme/unitos-pitada" });
      if (url.endsWith("/commits/main")) return Response.json({ sha: "generated" });
      return Response.json({});
    });
    const result = await c.ensureRepo({ initialProvision: true });
    expect(result).toMatchObject({ ok: true, created: true, via: "template_recovered" });
    expect(calls.some((call) => call.startsWith("DELETE "))).toBe(false);
    expect(calls.filter((call) => call.startsWith("PATCH "))).toHaveLength(2);
    expect(calls.some((call) => call.includes("/generate"))).toBe(true);
  });

  it("preserva o README intacto e cria destino alternativo quando não pode renomear", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const seed = Buffer.from(
      "# unitos-pitada\n\nInstalação Unitos. Código publicado a partir do MASTER.\n",
    ).toString("base64");
    const c = client(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = String(init?.body ?? "");
      calls.push({ url, method, body });
      if (url.endsWith("/repos/acme/unitos-pitada") && method === "PATCH") {
        return new Response("forbidden", { status: 403 });
      }
      if (url.endsWith("/repos/acme/unitos-pitada")) {
        return Response.json({ full_name: "acme/unitos-pitada" });
      }
      if (url.endsWith("/repos/acme/unitos-pitada-legacy-readme")) {
        return new Response("no", { status: 404 });
      }
      if (url.endsWith("/repos/acme/unitos-pitada-app")) {
        return new Response("no", { status: 404 });
      }
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "seed" } });
      if (url.includes("/git/trees/seed")) {
        return Response.json({ tree: [{ path: "README.md", type: "blob" }] });
      }
      if (url.includes("/contents/README.md")) {
        return Response.json({ encoding: "base64", content: seed });
      }
      if (url.endsWith("/repos/mahara-apps/unitos-master")) {
        return Response.json({ is_template: true });
      }
      if (url.endsWith("/generate")) return Response.json({ full_name: "acme/unitos-pitada-app" });
      if (url.endsWith("/repos/acme/unitos-pitada-app/commits/main")) {
        return Response.json({ sha: "generated" });
      }
      return Response.json({});
    });

    const result = await c.ensureRepo({ initialProvision: true });
    expect(result).toMatchObject({
      ok: true,
      created: true,
      via: "template_alternate",
      repoSlug: "acme/unitos-pitada-app",
      commitSha: "generated",
    });
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(calls.find((call) => call.url.endsWith("/generate"))?.body).toContain(
      '"name":"unitos-pitada-app"',
    );
  });

  it("restaura o nome original quando a geração pelo template falha", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    let originalExists = true;
    const seed = Buffer.from(
      "# unitos-pitada\n\nInstalação Unitos. Código publicado a partir do MASTER.\n",
    ).toString("base64");
    const c = client(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = String(init?.body ?? "");
      calls.push({ url, method, body });
      if (url.endsWith("/repos/acme/unitos-pitada") && method === "PATCH") {
        originalExists = false;
        return Response.json({ name: "unitos-pitada-legacy-readme" });
      }
      if (url.endsWith("/repos/acme/unitos-pitada"))
        return originalExists
          ? Response.json({ full_name: "acme/unitos-pitada" })
          : new Response("no", { status: 404 });
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "seed" } });
      if (url.includes("/git/trees/seed"))
        return Response.json({ tree: [{ path: "README.md", type: "blob" }] });
      if (url.includes("/contents/README.md"))
        return Response.json({ encoding: "base64", content: seed });
      if (url.endsWith("/repos/mahara-apps/unitos-master"))
        return Response.json({ is_template: true });
      if (url.endsWith("/repos/acme/unitos-pitada-legacy-readme") && method === "GET")
        return new Response("no", { status: 404 });
      if (url.endsWith("/repos/acme/unitos-pitada-legacy-readme") && method === "PATCH") {
        if (body.includes('"name":"unitos-pitada"')) originalExists = true;
        return Response.json({ ok: true });
      }
      if (url.endsWith("/generate")) return new Response("forbidden", { status: 403 });
      return Response.json({});
    });

    const result = await c.ensureRepo({ initialProvision: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("nome original foi restaurado");
    expect(originalExists).toBe(true);
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    expect(
      calls.some(
        (call) =>
          call.url.endsWith("unitos-pitada-legacy-readme") && call.body.includes("archived"),
      ),
    ).toBe(true);
  });

  it("preserva repositório existente com conteúdo real", async () => {
    const calls: string[] = [];
    const c = client(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "head" } });
      if (url.includes("/git/trees/head"))
        return Response.json({ tree: [{ path: "src/index.ts", type: "blob", sha: "code" }] });
      return Response.json({ full_name: "acme/unitos-pitada" });
    });
    expect(await c.ensureRepo({ initialProvision: true })).toMatchObject({
      ok: true,
      created: false,
      via: "existing",
    });
    expect(calls.some((call) => call.startsWith("DELETE "))).toBe(false);
  });

  it("publica só o que difere e cria um commit por cima da branch", async () => {
    const posted: string[] = [];
    const c = client(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") posted.push(`${method} ${url}`);
      if (url.includes("/repos/mahara-apps/unitos-master/git/trees")) {
        return Response.json({
          sha: "master_tree",
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
      if (url.includes("/git/blobs/"))
        return Response.json({ content: "eA==", encoding: "base64" });
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

  it("reaproveita a árvore raiz do MASTER sem remontar milhares de entradas", async () => {
    const posted: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const c = client(async (url: string, init?: RequestInit) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      if ((init?.method ?? "GET") !== "GET") posted.push({ url, body });
      if (url.includes("/repos/mahara-apps/unitos-master/git/trees/master_sha")) {
        return Response.json({
          sha: "master_tree",
          tree: [
            { path: "a.ts", type: "blob", mode: "100644", sha: "s1" },
            { path: "b.ts", type: "blob", mode: "100644", sha: "s2" },
          ],
        });
      }
      if (url.includes("/repos/acme/unitos-pitada/git/trees/dest")) {
        return Response.json({ tree: [{ path: "a.ts", type: "blob", mode: "100644", sha: "s1" }] });
      }
      if (url.includes("/repos/acme/unitos-pitada/git/trees/master_tree")) {
        return Response.json({ sha: "master_tree" });
      }
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "dest" } });
      if (url.includes("/git/commits")) return Response.json({ sha: "commit_new" });
      return Response.json({ ok: true });
    });

    const res = await c.publishSnapshot("master_sha");
    expect(res).toMatchObject({ ok: true, commitSha: "commit_new", changed: 1 });
    expect(posted.some((call) => call.url.endsWith("/git/trees"))).toBe(false);
    expect(posted.find((call) => call.url.endsWith("/git/commits"))?.body).toMatchObject({
      tree: "master_tree",
    });
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
    expect(
      second.posted.filter((p) => p.includes("POST") && p.endsWith("/git/blobs")),
    ).toHaveLength(0);
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

describe("resiliência ao montar a árvore", () => {
  it("tenta novamente quando o GitHub devolve 502 temporário", async () => {
    let treeAttempts = 0;
    const c = createCodeClient({
      token: "gh",
      owner: "acme",
      repo: "unitos-pitada",
      masterRepo: "mahara-apps/unitos-master",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        if (url.includes("/repos/mahara-apps/unitos-master/git/trees")) {
          return Response.json({
            tree: [{ path: "a.ts", type: "blob", mode: "100644", sha: "s1" }],
          });
        }
        if (url.includes("/repos/acme/unitos-pitada/git/trees/"))
          return Response.json({ tree: [] });
        if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "dest" } });
        if (url.includes("/repos/acme/unitos-pitada/git/blobs/")) {
          return new Response("not found", { status: 404 });
        }
        if (url.includes("/repos/mahara-apps/unitos-master/git/blobs/")) {
          return Response.json({ content: "eA==", encoding: "base64" });
        }
        if (url.endsWith("/git/blobs")) return Response.json({ sha: "copiado" });
        if (url.endsWith("/git/trees")) {
          treeAttempts += 1;
          if (treeAttempts === 1) {
            return new Response(JSON.stringify({ message: "Bad Gateway" }), {
              status: 502,
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
  }, 10_000);

  it("explica instabilidade persistente sem acusar credencial", async () => {
    const c = client(async (url: string, init?: RequestInit) => {
      if (url.includes("/repos/mahara-apps/unitos-master/git/trees")) {
        return Response.json({
          tree: [{ path: "a.ts", type: "blob", mode: "100644", sha: "s1" }],
        });
      }
      if (url.includes("/repos/acme/unitos-pitada/git/trees/")) return Response.json({ tree: [] });
      if (url.includes("/git/ref/heads/main")) return Response.json({ object: { sha: "dest" } });
      if (url.includes("/repos/acme/unitos-pitada/git/blobs/")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("/repos/mahara-apps/unitos-master/git/blobs/")) {
        return Response.json({ content: "eA==", encoding: "base64" });
      }
      if (url.endsWith("/git/blobs")) return Response.json({ sha: "copied" });
      if (url.endsWith("/git/trees") && init?.method === "POST") {
        return new Response("Bad Gateway", { status: 502 });
      }
      return Response.json({ ok: true });
    });

    const res = await c.publishSnapshot("master_sha");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Instabilidade temporária do GitHub");
    expect(res.error).not.toMatch(/token|credencial|permiss/i);
  }, 10_000);
});

describe("cota do GitHub e credencial do MASTER", () => {
  const withMaster = (fetchImpl: unknown) =>
    createCodeClient({
      token: "gh-instalacao",
      masterToken: "gh-master",
      owner: "acme",
      repo: "unitos-pitada",
      masterRepo: "mahara-apps/unitos-master",
      fetchImpl: fetchImpl as never,
    });

  it("lê o código do MASTER com a credencial do MASTER e grava no destino com a da instalação", async () => {
    const seen: Array<{ url: string; auth: string | null; method: string }> = [];
    const c = withMaster(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit);
      seen.push({
        url,
        auth: headers.get("authorization"),
        method: (init?.method ?? "GET").toUpperCase(),
      });
      if (url.includes("/repos/acme/unitos-pitada")) return new Response("no", { status: 404 });
      if (url.endsWith("/repos/mahara-apps/unitos-master"))
        return Response.json({ is_template: true });
      if (url.endsWith("/generate")) return Response.json({ full_name: "acme/unitos-pitada" });
      if (url.endsWith("/commits/main")) return Response.json({ sha: "generated" });
      return Response.json({ full_name: "acme/unitos-pitada", is_template: true });
    });
    await c.ensureRepo({ initialProvision: true });
    await c.permissions();
    const masterRead = seen.find((s) => s.method === "GET" && s.url.includes("unitos-master"));
    const generate = seen.find((s) => s.url.includes("/generate"));
    expect(masterRead?.auth).toBe("Bearer gh-master");
    expect(generate?.auth).toBe("Bearer gh-instalacao");
  });

  it("limite de uso do GitHub é explicado como cota, não como falta de permissão", async () => {
    const reset = Math.floor(Date.now() / 1000) + 900;
    const c = withMaster(
      async () =>
        new Response(JSON.stringify({ message: "API rate limit exceeded for user ID 1" }), {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
        }),
    );
    const checks = await c.permissions();
    const detail = checks.map((check) => check.detail).join(" | ");
    expect(detail).toContain("Limite de uso da API do GitHub");
    expect(detail).not.toContain("HTTP 403 ao");
  });

  it("checagem de permissões cobre cota, acesso ao destino e leitura do MASTER", async () => {
    const c = withMaster(async (url: string) => {
      if (url.endsWith("/rate_limit"))
        return Response.json({ resources: { core: { remaining: 4800, limit: 5000, reset: 0 } } });
      if (url.endsWith("/user")) return Response.json({ login: "acme" });
      return Response.json({
        full_name: "x",
        permissions: { push: true, admin: true },
        is_template: true,
      });
    });
    const checks = await c.permissions();
    expect(checks.length).toBeGreaterThanOrEqual(3);
    expect(checks.every((check) => check.area === "code")).toBe(true);
    expect(checks.every((check) => check.ok)).toBe(true);
  });
});
