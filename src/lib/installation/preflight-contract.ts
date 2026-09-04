/**
 * Preflight determinístico de provisionamento de uma instalação nova.
 *
 * Módulo PURO: não executa SQL, não lê secrets, não faz rede. Ele define, de
 * forma testável, quando uma instalação está realmente pronta para provisionar
 * e quando o provisionamento precisa ser recusado com BLOCKED.
 *
 * Regra central: ausência de pré-condição NUNCA vira PASS. O resultado é
 * BLOCKED (falta ambiente/credencial) ou FAIL (pré-condição inválida).
 */

import {
  containsMasterReference,
  validateCronSecret,
  validatePublicAppUrl,
} from "./bootstrap-contract";

/** Secrets que precisam ser exclusivos da instalação destino. */
export const INSTALLATION_SECRET_VARS = [
  "CRON_SECRET",
  "BRAND_CREDENTIALS_SECRET",
  "META_STATE_SECRET",
  "META_WEBHOOK_VERIFY_TOKEN",
] as const;

export type InstallationSecretVar = (typeof INSTALLATION_SECRET_VARS)[number];

/** Extensões Supabase sem as quais o baseline não pode ser aplicado. */
export const REQUIRED_EXTENSIONS = [
  "vector",
  "pg_net",
  "pg_cron",
  "supabase_vault",
  "pgcrypto",
] as const;

export type SecretSource =
  | { status: "generate" }
  | { status: "declared" }
  | { status: "blocked"; reason: string };

/**
 * Classifica a origem de um secret informado por ambiente.
 *
 * - ausente               -> "generate" (o bootstrap destino gera o valor);
 * - presente e declarado  -> "declared" (a instalação destino forneceu de propósito);
 * - presente e não declarado -> "blocked" (herança silenciosa do ambiente, ex. MASTER);
 * - presente com marca do MASTER -> "blocked" sempre.
 *
 * A declaração explícita usa UNITOS_INSTALL_SECRETS: "all" ou lista de nomes.
 */
export function classifySecretSource(input: {
  name: InstallationSecretVar;
  value: string | null | undefined;
  declared: string | null | undefined;
  masterEnvironment?: boolean;
}): SecretSource {
  const value = (input.value ?? "").trim();
  if (!value) return { status: "generate" };

  if (containsMasterReference(value)) {
    return { status: "blocked", reason: `${input.name} contém identificador do MASTER` };
  }

  const declared = (input.declared ?? "").trim().toLowerCase();
  const list = declared
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((item) => item.toUpperCase());
  const isDeclared = declared === "all" || list.includes(input.name);

  if (!isDeclared) {
    return {
      status: "blocked",
      reason: `${input.name} veio do ambiente sem declaração explícita (UNITOS_INSTALL_SECRETS) — herança do MASTER não é permitida`,
    };
  }

  if (input.masterEnvironment) {
    return {
      status: "blocked",
      reason: `${input.name} não pode ser reaproveitado a partir do ambiente MASTER`,
    };
  }

  if (input.name === "CRON_SECRET") {
    const cron = validateCronSecret(value);
    if (!cron.ok) return { status: "blocked", reason: cron.reason };
  }

  return { status: "declared" };
}

/** True quando o ambiente atual é o próprio MASTER. */
export function isMasterEnvironment(env: {
  role?: string | null;
  supabaseUrl?: string | null;
  appUrl?: string | null;
}): boolean {
  if ((env.role ?? "").trim().toLowerCase() === "master") return true;
  return containsMasterReference(env.supabaseUrl) || containsMasterReference(env.appUrl);
}

export type PreflightState = "pass" | "blocked" | "fail";

export type PreflightCheck = {
  id: string;
  label: string;
  state: PreflightState;
  detail: string;
};

export type PreflightInput = {
  /** Origem https própria da instalação destino. */
  publicAppUrl?: string | null;
  /** URL do projeto Supabase destino. */
  supabaseUrl?: string | null;
  /** Connection string do banco destino (nunca logada). */
  supabaseDbUrl?: string | null;
  /** Credencial de gestão/serviço disponível no ambiente de execução. */
  managementCredential?: string | null;
  /** Extensões efetivamente presentes no banco destino. */
  availableExtensions?: readonly string[] | null;
  /** Resultado do probe HTTP do endpoint publicado (status ou null). */
  endpointProbeStatus?: number | null;
  /** Secrets vistos no ambiente. */
  secrets?: Partial<Record<InstallationSecretVar, string | null | undefined>>;
  /** Conteúdo de UNITOS_INSTALL_SECRETS. */
  declaredSecrets?: string | null;
  /** Ambiente onde o preflight roda. */
  environment?: { role?: string | null; supabaseUrl?: string | null; appUrl?: string | null };
};

export type PreflightReport = {
  result: "PASS" | "BLOCKED" | "FAIL";
  checks: PreflightCheck[];
  blocked: string[];
  failed: string[];
};

/** Avalia todas as pré-condições de provisionamento real. */
export function evaluatePreflight(input: PreflightInput): PreflightReport {
  const checks: PreflightCheck[] = [];
  const master = isMasterEnvironment(input.environment ?? {});

  const url = validatePublicAppUrl(input.publicAppUrl);
  checks.push({
    id: "domain",
    label: "Domínio próprio (PUBLIC_APP_URL)",
    state: url.ok ? "pass" : (input.publicAppUrl ?? "").trim() ? "fail" : "blocked",
    detail: url.ok ? url.value : url.reason,
  });

  const supabaseUrl = (input.supabaseUrl ?? "").trim();
  checks.push({
    id: "supabase",
    label: "Projeto Supabase destino",
    state: !supabaseUrl
      ? "blocked"
      : containsMasterReference(supabaseUrl)
        ? "fail"
        : /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)
          ? "pass"
          : "fail",
    detail: !supabaseUrl
      ? "SUPABASE_URL do destino ausente"
      : containsMasterReference(supabaseUrl)
        ? "SUPABASE_URL aponta para o MASTER"
        : supabaseUrl,
  });

  const dbUrl = (input.supabaseDbUrl ?? "").trim();
  checks.push({
    id: "database",
    label: "Banco destino acessível (SUPABASE_DB_URL)",
    state: !dbUrl ? "blocked" : containsMasterReference(dbUrl) ? "fail" : "pass",
    detail: !dbUrl
      ? "SUPABASE_DB_URL ausente"
      : containsMasterReference(dbUrl)
        ? "SUPABASE_DB_URL aponta para o banco do MASTER"
        : "connection string presente (valor não exibido)",
  });

  const management = (input.managementCredential ?? "").trim();
  checks.push({
    id: "management",
    label: "Credencial de gestão do Supabase destino",
    state: management ? "pass" : "blocked",
    detail: management
      ? "presente (valor não exibido)"
      : "credencial de gestão ausente neste ambiente",
  });

  const extensions = input.availableExtensions ?? null;
  const missing = extensions
    ? REQUIRED_EXTENSIONS.filter((ext) => !extensions.includes(ext))
    : null;
  checks.push({
    id: "extensions",
    label: "Extensões obrigatórias do baseline",
    state: missing === null ? "blocked" : missing.length ? "fail" : "pass",
    detail:
      missing === null
        ? "não foi possível inspecionar as extensões do banco destino"
        : missing.length
          ? `ausentes: ${missing.join(", ")}`
          : REQUIRED_EXTENSIONS.join(", "),
  });

  const status = input.endpointProbeStatus ?? null;
  checks.push({
    id: "endpoint",
    label: "Frontend publicado no domínio da instalação",
    state:
      status === null
        ? "blocked"
        : status === 401 || status === 403 || status === 200
          ? "pass"
          : "fail",
    detail: status === null ? "sem resposta do endpoint publicado" : `HTTP ${status}`,
  });

  const secretDetails: string[] = [];
  let secretState: PreflightState = "pass";
  for (const name of INSTALLATION_SECRET_VARS) {
    const source = classifySecretSource({
      name,
      value: input.secrets?.[name] ?? null,
      declared: input.declaredSecrets ?? null,
      masterEnvironment: master,
    });
    if (source.status === "blocked") {
      secretState = "fail";
      secretDetails.push(source.reason);
    } else {
      secretDetails.push(
        `${name}: ${source.status === "generate" ? "será gerado no destino" : "declarado pelo destino"}`,
      );
    }
  }
  checks.push({
    id: "secrets",
    label: "Secrets exclusivos da instalação",
    state: secretState,
    detail: secretDetails.join("; "),
  });

  checks.push({
    id: "isolation",
    label: "Isolamento em relação ao MASTER",
    state: master ? "fail" : "pass",
    detail: master
      ? "o preflight está rodando no ambiente MASTER — provisionamento precisa rodar no destino"
      : "nenhum identificador do MASTER no ambiente de execução",
  });

  const failed = checks.filter((c) => c.state === "fail").map((c) => c.id);
  const blocked = checks.filter((c) => c.state === "blocked").map((c) => c.id);
  const result: PreflightReport["result"] = failed.length
    ? "FAIL"
    : blocked.length
      ? "BLOCKED"
      : "PASS";
  return { result, checks, blocked, failed };
}

/**
 * Resultado final do bootstrap. Um abort de pré-condição é sempre BLOCKED e um
 * FAIL de etapa é sempre FAIL — nunca PASS.
 */
export function formatBootstrapResult(input: { aborted?: boolean; failures: number }): {
  result: "PASS" | "FAIL" | "BLOCKED";
  exitCode: number;
} {
  if (input.aborted) return { result: "BLOCKED", exitCode: 2 };
  if (input.failures > 0) return { result: "FAIL", exitCode: 1 };
  return { result: "PASS", exitCode: 0 };
}
