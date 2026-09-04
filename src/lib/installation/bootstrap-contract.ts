/**
 * Installation Contract — validações puras do bootstrap de uma instalação nova.
 *
 * Este módulo NÃO executa SQL, não lê secrets e não faz rede. Ele existe para
 * que as regras críticas do bootstrap (URL própria, isolamento do MASTER,
 * contagens esperadas do baseline, ordem dos arquivos) sejam testáveis e
 * compartilhadas entre o script de bootstrap e a documentação.
 *
 * Invariantes garantidos aqui:
 *  - PUBLIC_APP_URL precisa ser https absoluto, sem credenciais/query/hash;
 *  - nenhuma referência ao MASTER (ref do Supabase ou domínio) é aceita;
 *  - todo cron HTTP precisa apontar para a MESMA origem da instalação;
 *  - CRON_SECRET precisa ter no mínimo 16 caracteres (regra de set_cron_secret).
 */

/** Identificadores do MASTER que nunca podem aparecer em uma instalação nova. */
export const MASTER_FORBIDDEN_TOKENS = [
  "tkjbhttylouamqxnbfgv",
  "unitos-master.lovable.app",
] as const;

/** Tamanho mínimo aceito por public.set_cron_secret(). */
export const MIN_CRON_SECRET_LENGTH = 16;

/** Ordem definitiva de aplicação do baseline. */
export const BASELINE_ORDER = [
  "000_extensions.sql",
  "001_initial_schema.sql",
  "005_auth_trigger.sql",
  "003_storage_buckets.sql",
  "006_storage_policies.sql",
  "004_seeds.sql",
] as const;

/** Contagens esperadas do baseline (usadas por verify-installation.sql). */
export const BASELINE_EXPECTED_COUNTS = {
  tables: 89,
  enums: 10,
  functions: 133,
  policies: 200,
  triggers: 96,
  matviews: 1,
  buckets: 5,
  storagePolicies: 12,
  agentPrompts: 9,
  featureCatalog: 14,
  brainRetentionConfig: 7,
  cronJobs: 14,
  cronHttpJobs: 9,
} as const;

/** Buckets privados obrigatórios. */
export const REQUIRED_BUCKETS = [
  "brand-assets",
  "brand-documents",
  "brand-media",
  "avatars",
  "chat-attachments",
] as const;

/** Paths dos crons HTTP — todos devem usar a origem da própria instalação. */
export const CRON_HTTP_PATHS = [
  "/api/public/media/prune",
  "/api/public/hooks/brain-consolidate",
  "/api/public/cron/sla-check",
  "/api/public/meta/publish-scheduled",
  "/api/public/hooks/brain-synthesis",
  "/api/public/hooks/social-metrics-sync",
  "/api/public/hooks/ai-models-health",
  "/api/public/cron/import-worker",
  "/api/public/cron/import-reaper",
] as const;

export type ValidationResult = { ok: true; value: string } | { ok: false; reason: string };

/** True quando o texto contém qualquer identificador do MASTER. */
export function containsMasterReference(value: string | null | undefined): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return MASTER_FORBIDDEN_TOKENS.some((token) => lower.includes(token));
}

/**
 * Valida a URL pública da instalação e devolve a origem normalizada
 * (sem barra final, sem path/query/hash).
 */
export function validatePublicAppUrl(raw: string | null | undefined): ValidationResult {
  const candidate = (raw ?? "").trim();
  if (!candidate) return { ok: false, reason: "PUBLIC_APP_URL ausente" };

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "PUBLIC_APP_URL não é uma URL absoluta válida" };
  }

  if (url.protocol !== "https:") return { ok: false, reason: "PUBLIC_APP_URL precisa usar https" };
  if (url.username || url.password) {
    return { ok: false, reason: "PUBLIC_APP_URL não pode conter credenciais" };
  }
  if (url.search || url.hash) {
    return { ok: false, reason: "PUBLIC_APP_URL não pode conter query string ou hash" };
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return { ok: false, reason: "PUBLIC_APP_URL precisa ser apenas a origem (sem path)" };
  }
  if (containsMasterReference(url.origin)) {
    return { ok: false, reason: "PUBLIC_APP_URL aponta para o MASTER" };
  }

  return { ok: true, value: url.origin };
}

/** Valida o CRON_SECRET conforme a regra de public.set_cron_secret(). */
export function validateCronSecret(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (value.length < MIN_CRON_SECRET_LENGTH) {
    return { ok: false, reason: `CRON_SECRET precisa ter ao menos ${MIN_CRON_SECRET_LENGTH} caracteres` };
  }
  if (containsMasterReference(value)) return { ok: false, reason: "CRON_SECRET reaproveitado do MASTER" };
  return { ok: true, value };
}

/** Monta as URLs completas dos crons HTTP a partir da origem validada. */
export function buildCronUrls(origin: string): string[] {
  const base = origin.replace(/\/+$/, "");
  return CRON_HTTP_PATHS.map((path) => `${base}${path}`);
}

/**
 * Guard anti-cross-installation: recusa qualquer comando de cron cuja URL não
 * pertença à origem da própria instalação.
 */
export function assertCronTargetsOwnOrigin(
  commands: readonly string[],
  origin: string,
): { ok: boolean; offenders: string[] } {
  const base = origin.replace(/\/+$/, "");
  const offenders: string[] = [];
  for (const command of commands) {
    for (const match of command.matchAll(/https?:\/\/[^\s'"]+/g)) {
      const found = match[0].replace(/[)'";,]+$/, "");
      if (!found.startsWith(`${base}/`) && found !== base) offenders.push(found);
    }
  }
  return { ok: offenders.length === 0, offenders };
}

/** Nunca copiar dados de negócio: tabelas que devem nascer vazias. */
export const BUSINESS_TABLES_MUST_BE_EMPTY = [
  "brands",
  "clients",
  "projects",
  "tasks",
  "posts",
  "social_connections",
  "brand_api_credentials",
  "user_profiles",
  "installation_meta_app",
] as const;

/** Seeds permitidos: somente catálogo/configuração. */
export const ALLOWED_SEED_TABLES = [
  "agent_prompts",
  "feature_catalog",
  "brain_retention_config",
  "installation",
] as const;

export function isAllowedSeedTable(table: string): boolean {
  return (ALLOWED_SEED_TABLES as readonly string[]).includes(table);
}
