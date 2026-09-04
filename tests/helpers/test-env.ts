/**
 * Barreira de ambiente para criação de identidades privilegiadas em testes.
 *
 * Regra fundamental: a suíte NUNCA cria contas SUPER ADMIN reais fora de um
 * ambiente explicitamente identificado como teste. Ambiente desconhecido é
 * tratado como produção (fail-closed) — não existe fallback permissivo.
 *
 * Configuração confiável (env do runner, não valor vindo do usuário/HTTP):
 *   UNITOS_TEST_ENV=test            -> habilita criação privilegiada
 *   UNITOS_PRODUCTION_PROJECT_REF   -> ref do Supabase de produção (bloqueio duro)
 *   UNITOS_TEST_USER_PASSWORD_SECRET (opcional) -> segredo exclusivo de teste
 */

export type PrivilegedEnvVerdict =
  | { allowed: true }
  | { allowed: false; reason: "not_declared_test" | "production_project" };

function projectRef(): string | null {
  const explicit = process.env["SUPABASE_PROJECT_ID"];
  if (explicit) return explicit;
  const url = process.env["SUPABASE_URL"] ?? "";
  const m = /https?:\/\/([a-z0-9]+)\.supabase\./i.exec(url);
  return m?.[1] ?? null;
}

/** Veredito determinístico do ambiente atual. */
export function privilegedTestEnv(): PrivilegedEnvVerdict {
  const declared = (process.env["UNITOS_TEST_ENV"] ?? "").trim().toLowerCase();
  const prodRef = (process.env["UNITOS_PRODUCTION_PROJECT_REF"] ?? "").trim();
  const ref = projectRef();

  // Bloqueio duro: mesmo declarado como teste, nunca contra o projeto de produção.
  if (prodRef && ref && prodRef === ref) return { allowed: false, reason: "production_project" };
  if (declared !== "test") return { allowed: false, reason: "not_declared_test" };
  return { allowed: true };
}

export function privilegedTestEnvAllowed(): boolean {
  return privilegedTestEnv().allowed;
}

/** Falha explícita quando o ambiente não é comprovadamente de teste. */
export function assertPrivilegedTestEnv(operation = "TEST_SUPER_ADMIN_CREATION"): void {
  const v = privilegedTestEnv();
  if (v.allowed) return;
  const detail =
    v.reason === "production_project"
      ? "projeto Supabase identificado como PRODUÇÃO"
      : "ambiente não declarado como teste (UNITOS_TEST_ENV != 'test')";
  throw new Error(`${operation} bloqueado: ${detail}. Nenhum fallback é permitido.`);
}
