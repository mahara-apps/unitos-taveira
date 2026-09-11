import { beforeAll, describe, expect, it } from "vitest";

import { CRITICAL_ACTIONS, CRITICAL_ACTION_KEYS } from "@/lib/critical-actions";
import { PROPAGATE_GITHUB_TOKEN_CONFIRM_LABEL } from "@/lib/installation/manager.functions";
import type { GithubTokenPropagationResult } from "@/lib/installation/credentials.server";

type Row = Record<string, unknown>;

function makeClient(opts?: { failOnInstallationId?: string }) {
  const rows: Row[] = [];
  return {
    rows,
    from(table: string) {
      expect(table).toBe("installation_credentials");
      return {
        async upsert(payload: Row, _opts?: unknown) {
          if (payload.installation_id === opts?.failOnInstallationId) {
            return { error: new Error("falha simulada de gravação") };
          }
          rows.push(payload);
          return { error: null };
        },
      };
    },
  };
}

describe("propagação do token do GitHub do MASTER", () => {
  beforeAll(() => {
    process.env.BRAND_CREDENTIALS_SECRET = "segredo-de-teste";
  });

  it("está registrada como ação crítica auditável", () => {
    expect(CRITICAL_ACTION_KEYS).toContain("installation.propagate_github_token");
    const def = CRITICAL_ACTIONS["installation.propagate_github_token"];
    expect(def.title).toContain("MASTER");
    expect(def.impact).toContain("TODAS");
    expect(PROPAGATE_GITHUB_TOKEN_CONFIRM_LABEL).toBe("APLICAR EM TODAS");
  });

  it("grava o token cifrado em todas as instalações, nunca em claro", async () => {
    const { propagateGithubTokenToInstallations } = await import(
      "@/lib/installation/credentials.server"
    );
    const client = makeClient();
    const results = await propagateGithubTokenToInstallations({
      client,
      actorId: "super-admin",
      githubToken: "github_pat_novo",
      installations: [
        { id: "inst-1", name: "Casa 8" },
        { id: "inst-2", name: "Taveira" },
      ],
    });

    expect(results).toEqual<GithubTokenPropagationResult[]>([
      { id: "inst-1", name: "Casa 8", ok: true },
      { id: "inst-2", name: "Taveira", ok: true },
    ]);
    expect(client.rows).toHaveLength(2);
    for (const row of client.rows) {
      const cipher = row.github_token_ciphertext as string;
      expect(typeof cipher).toBe("string");
      expect(cipher).not.toContain("github_pat_novo");
      expect(row.updated_by).toBe("super-admin");
    }
    // Confirma que o valor gravado decifra para o token propagado.
    const { decryptCredential } = await import("@/lib/credentials-crypto.server");
    for (const row of client.rows) {
      await expect(decryptCredential(row.github_token_ciphertext as string)).resolves.toBe(
        "github_pat_novo",
      );
    }
  });

  it("falha individual não interrompe as demais instalações", async () => {
    const { propagateGithubTokenToInstallations } = await import(
      "@/lib/installation/credentials.server"
    );
    const client = makeClient({ failOnInstallationId: "inst-2" });
    const results = await propagateGithubTokenToInstallations({
      client,
      actorId: "super-admin",
      githubToken: "github_pat_novo",
      installations: [
        { id: "inst-1", name: "Casa 8" },
        { id: "inst-2", name: "Falhada" },
        { id: "inst-3", name: "Taveira" },
      ],
    });

    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1]?.error).toContain("falha simulada");
    expect(JSON.stringify(results)).not.toContain("github_pat_novo");
  });

  it("rejeita token vazio antes de tocar no banco", async () => {
    const { propagateGithubTokenToInstallations } = await import(
      "@/lib/installation/credentials.server"
    );
    const client = makeClient();
    await expect(
      propagateGithubTokenToInstallations({
        client,
        actorId: "super-admin",
        githubToken: "   ",
        installations: [{ id: "inst-1", name: "Casa 8" }],
      }),
    ).rejects.toThrow(/não configurado/i);
    expect(client.rows).toHaveLength(0);
  });
});
