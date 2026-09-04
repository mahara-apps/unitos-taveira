/**
 * URL canônica POR INSTALAÇÃO/WORKSPACE (server-only).
 *
 * Problema resolvido: em requisições HTTP o host real identifica a instalação,
 * mas em cron/jobs/workers não existe requisição — e usar `PUBLIC_APP_URL`
 * nesse caso faz um processo que atende as instalações A e B gerar links do
 * mesmo domínio para as duas.
 *
 * Solução: cada workspace guarda a própria URL em `brands.app_url`. Ela é
 * aprendida a cada requisição real do workspace (`rememberInstallationUrl`) e é
 * a ÚNICA fonte usada por disparos assíncronos.
 *
 * Ordem de resolução quando existe `brandId`:
 *   1. host da requisição atual (e persiste em `brands.app_url`);
 *   2. `brands.app_url` do próprio workspace (caminho de cron/worker);
 *   3. erro explícito `InstallationUrlUnknownError` — nunca `PUBLIC_APP_URL`,
 *      nunca domínio de outra instalação, nunca domínio genérico.
 *
 * `PUBLIC_APP_URL` continua válido apenas para cenários sem workspace algum
 * (ver `app-url.server.ts`), jamais para completar contexto ausente aqui.
 */

import { requestOrigin } from "./app-url.server";

export class InstallationUrlUnknownError extends Error {
  code = "instalacao_url_desconhecida" as const;
  constructor(brandId: string) {
    super(`instalacao_url_desconhecida:${brandId}`);
    this.name = "InstallationUrlUnknownError";
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type InstallationSupabase = {
  from: (table: string) => any;
};

type BrandUrlRow = { app_url?: string | null };

function normalize(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/**
 * Memo por worker: evita reescrever `brands.app_url` a cada requisição do mesmo
 * workspace no mesmo processo. NÃO é fonte de verdade entre instalações — a
 * chave inclui o brandId, então A nunca lê o valor de B.
 */
const learned = new Map<string, string>();

async function readStoredUrl(
  supabase: InstallationSupabase,
  brandId: string,
): Promise<string | null> {
  try {
    const res = await supabase
      .from("brands")
      .select("app_url")
      .eq("id", brandId)
      .maybeSingle();
    const row = (res?.data ?? null) as BrandUrlRow | null;
    return normalize(row?.app_url ?? null);
  } catch {
    return null;
  }
}

/**
 * Persiste a URL da instalação no workspace. Usa o client de serviço porque
 * fluxos legítimos (portal, convites por manager) não têm permissão de update
 * em `brands`; o `brandId` já vem validado pelo chamador.
 */
async function persistUrl(brandId: string, url: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as unknown as InstallationSupabase)
      .from("brands")
      .update({ app_url: url })
      .eq("id", brandId);
  } catch (error) {
    console.error("[installation-url] falha ao registrar a URL da instalação", error);
  }
}

/**
 * Chamada nos fluxos com requisição HTTP: grava/atualiza a URL da instalação do
 * workspace para que jobs assíncronos possam reconstruí-la depois.
 */
export async function rememberInstallationUrl(
  supabase: InstallationSupabase,
  brandId: string,
): Promise<string | null> {
  const origin = await requestOrigin();
  if (!origin) return null;
  if (learned.get(brandId) === origin) return origin;
  const stored = await readStoredUrl(supabase, brandId);
  if (stored !== origin) await persistUrl(brandId, origin);
  learned.set(brandId, origin);
  return origin;
}

/** URL canônica da instalação do workspace. Lança quando indeterminável. */
export async function resolveInstallationUrl(
  supabase: InstallationSupabase,
  brandId: string,
): Promise<string> {
  if (!brandId) throw new InstallationUrlUnknownError("sem_brand_id");

  const origin = await requestOrigin();
  if (origin) {
    if (learned.get(brandId) !== origin) {
      const stored = await readStoredUrl(supabase, brandId);
      if (stored !== origin) await persistUrl(brandId, origin);
      learned.set(brandId, origin);
    }
    return origin;
  }

  // Disparo assíncrono (cron/job/worker): só a URL do próprio workspace serve.
  const stored = await readStoredUrl(supabase, brandId);
  if (stored) return stored;
  throw new InstallationUrlUnknownError(brandId);
}

/** URL absoluta no domínio da instalação do workspace. */
export async function installationAbsoluteUrl(
  supabase: InstallationSupabase,
  brandId: string,
  path: string,
): Promise<string> {
  const base = await resolveInstallationUrl(supabase, brandId);
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Versão tolerante: null quando a instalação não pôde ser determinada. */
export async function tryInstallationAbsoluteUrl(
  supabase: InstallationSupabase,
  brandId: string,
  path: string,
): Promise<string | null> {
  try {
    return await installationAbsoluteUrl(supabase, brandId, path);
  } catch (error) {
    if (error instanceof InstallationUrlUnknownError) {
      console.error(
        `[installation-url] URL da instalação desconhecida para o workspace ${brandId}; link não gerado`,
      );
      return null;
    }
    throw error;
  }
}

/** Somente para testes: limpa o memo por worker. */
export function __resetInstallationUrlMemo(): void {
  learned.clear();
}
