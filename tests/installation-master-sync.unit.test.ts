import { describe, expect, it } from "vitest";

import { MASTER_RELEASE_VERSION } from "@/lib/installation/manager-contract";
import delta from "../supabase/baseline-snapshot/007_delta_migrations.sql?raw";
import versionRaw from "../supabase/baseline-snapshot/tools/delta_version.txt?raw";
import verifySql from "../supabase/install/verify-installation.sql?raw";

/**
 * MASTER-first: nenhuma alteracao do sistema pode ficar fora do pacote que as
 * instalacoes recebem. Este teste é o guardiao da regra:
 *  1. o pacote precisa estar regenerado (impressao digital registrada);
 *  2. a versao anunciada pelo MASTER precisa acompanhar o pacote;
 *  3. toda tabela criada pelo pacote precisa ser conferida no relatorio de saude.
 */

function parseVersionFile(raw: string): { version: string; sha256: string } {
  const get = (key: string) =>
    raw
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${key}=`))
      ?.slice(key.length + 1)
      .trim() ?? "";
  return { version: get("version"), sha256: get("sha256") };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Tabelas do delta que NAO sao replicadas/verificadas na instalacao:
// helpers internos do provisionamento e registro exclusivo do MASTER.
const NAO_VERIFICADAS = new Set([
  "installations",
  "installation_operations",
  "installation_credentials",
]);

function tabelasDoDelta(sql: string): string[] {
  // Tabelas criadas apenas como passo intermediario e renomeadas no mesmo
  // pacote (ex.: brain_events_new -> brain_events) nunca existem no destino:
  // o nome final entra na verificacao, o intermediario sai.
  const renomeadas = new Map<string, string>();
  const reRename = /ALTER TABLE (?:IF EXISTS )?public\.([a-z0-9_]+)\s+RENAME TO ([a-z0-9_]+)/gi;
  for (const m of sql.matchAll(reRename)) {
    renomeadas.set(m[1]!.toLowerCase(), m[2]!.toLowerCase());
  }

  const re = /CREATE TABLE (?:IF NOT EXISTS )?public\.([a-z0-9_]+)/gi;
  const out = new Set<string>();
  for (const m of sql.matchAll(re)) {
    let nome = m[1]!.toLowerCase();
    // Segue a cadeia de renomeacoes ate o nome final.
    const vistos = new Set<string>();
    while (renomeadas.has(nome) && !vistos.has(nome)) {
      vistos.add(nome);
      nome = renomeadas.get(nome)!;
    }
    if (nome.startsWith("_unitos_")) continue;
    if (NAO_VERIFICADAS.has(nome)) continue;
    out.add(nome);
  }
  return [...out].sort();
}


describe("sincronia MASTER-first", () => {
  const { version, sha256 } = parseVersionFile(versionRaw);

  it("delta_version.txt declara versao e impressao digital", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("o pacote foi regenerado (impressao digital confere)", async () => {
    expect(await sha256Hex(delta)).toBe(sha256);
  });

  it("MASTER_RELEASE_VERSION acompanha o pacote", () => {
    expect(MASTER_RELEASE_VERSION).toBe(version);
  });

  it("relatorio de saude confere todas as tabelas do pacote", () => {
    const faltando = tabelasDoDelta(delta).filter((t) => !verifySql.includes(`'${t}'`) && !verifySql.includes(`public.${t}`));
    expect(faltando).toEqual([]);
  });
});
