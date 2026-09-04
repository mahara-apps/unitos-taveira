/**
 * Política de refresh da descoberta Meta (módulo puro, testável).
 *
 * A varredura COMPLETA (`deep: true`) percorre `/me/accounts`, `/me/businesses`
 * e três arestas por portfólio — dezenas a centenas de requisições. Na maior
 * parte das sincronizações nada disso mudou: o que o operador quer é apenas
 * revalidar as Páginas do usuário.
 *
 * Este módulo decide, sem fazer I/O, entre:
 *  - `full`        → varredura profunda (autoridade total sobre os ativos);
 *  - `incremental` → varredura rasa (`deep: false`, só `/me/accounts`) mesclada
 *                    ao payload já conhecido.
 *
 * A varredura completa acontece SOMENTE quando:
 *  1. o token é novo (nenhuma varredura conhecida para esta autorização);
 *  2. não existe cache de ativos;
 *  3. o cache está expirado;
 *  4. o usuário pediu descoberta completa explicitamente.
 */

import {
  mergeDiscoveredPages,
  type CachedPagesPayload,
  type PublishAuthorizationInfo,
} from "./portfolio-shared";

/** Janela em que o payload salvo é considerado válido para refresh incremental. */
export const INCREMENTAL_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

export type DiscoveryMode = "full" | "incremental";

export type DiscoveryModeReason =
  | "requested_full"
  | "new_token"
  | "no_cache"
  | "expired_cache"
  | "fresh_cache";

export type DiscoveryModeInput = {
  /** Usuário pediu descoberta completa (botão "descoberta completa"). */
  requestedFull?: boolean;
  /** Quantidade de ativos já conhecidos no payload salvo. */
  knownAssetCount: number;
  /** `portfolio_loaded_at` da sessão (ISO) ou null. */
  loadedAt?: string | null;
  /** Esta autorização/token já foi varrida profundamente nesta instância? */
  tokenAlreadyScanned?: boolean;
  now?: number;
  maxAgeMs?: number;
};

export type DiscoveryModeDecision = {
  mode: DiscoveryMode;
  reason: DiscoveryModeReason;
  /** `deep` a passar para `scanPortfolio`. */
  deep: boolean;
  /** Idade do cache em ms, quando conhecida. */
  cacheAgeMs: number | null;
};

export function decideDiscoveryMode(input: DiscoveryModeInput): DiscoveryModeDecision {
  const now = input.now ?? Date.now();
  const maxAge = input.maxAgeMs ?? INCREMENTAL_MAX_AGE_MS;
  const parsed = input.loadedAt ? new Date(input.loadedAt).getTime() : NaN;
  const cacheAgeMs = Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;

  const full = (reason: DiscoveryModeReason): DiscoveryModeDecision => ({
    mode: "full",
    reason,
    deep: true,
    cacheAgeMs,
  });

  if (input.requestedFull === true) return full("requested_full");
  if (input.knownAssetCount <= 0) return full("no_cache");
  if (input.tokenAlreadyScanned !== true) return full("new_token");
  if (cacheAgeMs === null || cacheAgeMs > maxAge) return full("expired_cache");

  return { mode: "incremental", reason: "fresh_cache", deep: false, cacheAgeMs };
}

/** Frase curta em pt-BR para telemetria/UI. */
export function describeDiscoveryDecision(d: DiscoveryModeDecision): string {
  const reasons: Record<DiscoveryModeReason, string> = {
    requested_full: "descoberta completa solicitada",
    new_token: "nova autorização da Meta",
    no_cache: "sem ativos em cache",
    expired_cache: "cache de ativos expirado",
    fresh_cache: "ativos em cache ainda válidos",
  };
  return `${d.mode === "full" ? "varredura completa" : "refresh incremental"} (${reasons[d.reason]})`;
}

/**
 * Mescla o resultado de um refresh incremental (varredura rasa, só
 * `/me/accounts`) ao payload já conhecido.
 *
 * Regras:
 *  - Páginas: a linha nova ganha, mas nenhuma Página conhecida é descartada
 *    (a varredura rasa não enxerga ativos de Business Portfolio).
 *  - Instagram avulso, portfólios e contagem de portfólios: preservados do
 *    cache — a varredura rasa não os consulta.
 *  - Warnings: união, sem duplicatas.
 */
export function mergeIncrementalPayload(
  known: CachedPagesPayload,
  scanned: CachedPagesPayload,
  publishAuthorization?: PublishAuthorizationInfo | null,
): CachedPagesPayload {
  return {
    pages: mergeDiscoveredPages(scanned.pages, known.pages),
    standaloneInstagram:
      scanned.standaloneInstagram.length > 0
        ? scanned.standaloneInstagram
        : known.standaloneInstagram,
    warnings: Array.from(new Set([...known.warnings, ...scanned.warnings])),
    businessCount: Math.max(known.businessCount ?? 0, scanned.businessCount ?? 0),
    businesses:
      (scanned.businesses ?? []).length > 0 ? scanned.businesses : (known.businesses ?? []),
    publishAuthorization:
      publishAuthorization ?? scanned.publishAuthorization ?? known.publishAuthorization ?? null,
  };
}
