/**
 * Provisionamento AUTOMATIZADO de instalações — regras puras.
 *
 * Módulo PURO: sem rede, sem SQL, sem secrets. Ele define, de forma testável:
 *  - quais credenciais de gestão o MASTER precisa ter para automatizar;
 *  - o plano de etapas do provisionamento automático;
 *  - a resolução da URL operacional (domínio definitivo OU URL temporária);
 *  - o plano de variáveis de ambiente do deploy;
 *  - a recusa explícita (BLOCKED) quando qualquer dependência externa falta.
 *
 * Invariantes:
 *  - ausência de credencial/dependência NUNCA vira PASS: sempre BLOCKED com motivo;
 *  - nenhum secret do MASTER é reutilizado na instalação de destino;
 *  - nada pode apontar para o Supabase/domínio do MASTER;
 *  - o MASTER só usa credenciais de gestão PRÓPRIAS (do seu ambiente).
 */

import { containsMasterReference } from "./bootstrap-contract";
import {
  classifyOperationalUrl,
  type OperationalUrlKind,
} from "./readiness-contract";

/* ------------------------------------------------------------ credenciais */

/**
 * Credenciais de gestão que ficam SOMENTE no ambiente do MASTER.
 * O prefixo `SUPABASE_` é reservado pela plataforma, então os nomes oficiais
 * usam o prefixo `UNITOS_`.
 */
export const AUTOMATION_CREDENTIAL_VARS = {
  supabaseManagement: ["UNITOS_SUPABASE_MANAGEMENT_TOKEN"],
  vercel: ["UNITOS_VERCEL_TOKEN"],
  vercelTeam: ["UNITOS_VERCEL_TEAM_ID"],
  github: ["UNITOS_GITHUB_TOKEN"],
} as const;



export type AutomationEnv = Record<string, string | undefined | null>;

function pick(env: AutomationEnv, names: readonly string[]): string | null {
  for (const name of names) {
    const value = (env[name] ?? "").trim();
    if (value) return value;
  }
  return null;
}

/** Nome (nunca o valor) da variável que satisfez a credencial. */
function pickName(env: AutomationEnv, names: readonly string[]): string | null {
  for (const name of names) {
    if ((env[name] ?? "").trim()) return name;
  }
  return null;
}

export type CapabilityState = {
  available: boolean;
  reason: string | null;
  /** Nome da variável reconhecida — diagnóstico sem valor. */
  resolvedFrom?: string | null;
  /** Nomes aceitos, para o operador conferir a configuração. */
  acceptedNames?: readonly string[];
};

export type AutomationCapability = {
  /** Provisionamento automático do banco/schema/secrets do Supabase destino. */
  supabase: CapabilityState;
  /** Configuração automática das variáveis e leitura da URL do deploy. */
  vercel: CapabilityState;
  /** Publicação do código do MASTER no repositório da instalação. */
  github: CapabilityState;
  /** True quando o fluxo automatizado pode ser oferecido na UI. */
  available: boolean;
  /** Motivos explícitos de BLOCKED — exibidos ao operador, sem valores. */
  blockedReasons: string[];
};

/**
 * Descobre o que o MASTER consegue automatizar com as credenciais que ELE
 * possui. Nunca devolve `available` por omissão.
 */
export function resolveAutomationCapability(env: AutomationEnv): AutomationCapability {
  const management = pick(env, AUTOMATION_CREDENTIAL_VARS.supabaseManagement);
  const vercel = pick(env, AUTOMATION_CREDENTIAL_VARS.vercel);
  const github = pick(env, AUTOMATION_CREDENTIAL_VARS.github);


  const supabase: CapabilityState = management
    ? {
        available: true,
        reason: null,
        resolvedFrom: pickName(env, AUTOMATION_CREDENTIAL_VARS.supabaseManagement),
        acceptedNames: AUTOMATION_CREDENTIAL_VARS.supabaseManagement,
      }
    : {
        available: false,
        reason:
          "Credencial de gestão do Supabase ausente no runtime do MASTER — provisionamento automático BLOCKED. Nomes aceitos: " +
          AUTOMATION_CREDENTIAL_VARS.supabaseManagement.join(", "),
        resolvedFrom: null,
        acceptedNames: AUTOMATION_CREDENTIAL_VARS.supabaseManagement,
      };

  const vercelState: CapabilityState = vercel
    ? {
        available: true,
        reason: null,
        resolvedFrom: pickName(env, AUTOMATION_CREDENTIAL_VARS.vercel),
        acceptedNames: AUTOMATION_CREDENTIAL_VARS.vercel,
      }
    : {
        available: false,
        reason:
          "Token de gestão do deploy ausente no runtime do MASTER — configuração automática de variáveis e URL temporária BLOCKED. Nomes aceitos: " +
          AUTOMATION_CREDENTIAL_VARS.vercel.join(", "),
        resolvedFrom: null,
        acceptedNames: AUTOMATION_CREDENTIAL_VARS.vercel,
      };

  const githubState: CapabilityState = github
    ? {
        available: true,
        reason: null,
        resolvedFrom: pickName(env, AUTOMATION_CREDENTIAL_VARS.github),
        acceptedNames: AUTOMATION_CREDENTIAL_VARS.github,
      }
    : {
        available: false,
        reason:
          "Token do GitHub ausente no runtime do MASTER — publicação do código no repositório da instalação BLOCKED. Nomes aceitos: " +
          AUTOMATION_CREDENTIAL_VARS.github.join(", "),
        resolvedFrom: null,
        acceptedNames: AUTOMATION_CREDENTIAL_VARS.github,
      };

  const blockedReasons = [supabase.reason, vercelState.reason, githubState.reason].filter(
    (r): r is string => !!r,
  );
  return {
    supabase,
    vercel: vercelState,
    github: githubState,
    available: supabase.available && vercelState.available && githubState.available,
    blockedReasons,
  };
}

/* ------------------------------------------------------------------ alvo */

export type AutomationTarget =
  | { ok: true; projectRef: string; deployProject: string }
  | { ok: false; reason: string };

/** Extrai o ref do projeto Supabase a partir do ref informado ou da URL. */
export function extractProjectRef(input: {
  supabaseProjectRef?: string | null;
  supabaseUrl?: string | null;
}): string | null {
  const ref = (input.supabaseProjectRef ?? "").trim();
  if (/^[a-z0-9]{16,}$/i.test(ref)) return ref.toLowerCase();
  const url = (input.supabaseUrl ?? "").trim();
  const match = url.match(/https?:\/\/([a-z0-9]{16,})\.supabase\.co/i);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Valida o alvo do provisionamento automático. Não exige domínio definitivo:
 * a URL temporária do deploy é resolvida depois, automaticamente.
 */
export function resolveAutomationTarget(input: {
  domain?: string | null;
  supabaseUrl?: string | null;
  supabaseProjectRef?: string | null;
  deployProject?: string | null;
}): AutomationTarget {
  const blob = [input.domain, input.supabaseUrl, input.supabaseProjectRef, input.deployProject]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  if (containsMasterReference(blob)) {
    return {
      ok: false,
      reason:
        "O alvo aponta para o MASTER — provisionamento recusado. Use o Supabase e o deploy da própria instalação.",
    };
  }

  const projectRef = extractProjectRef(input);
  if (!projectRef) {
    return {
      ok: false,
      reason:
        "Informe o Project Ref (ou a URL) do Supabase da instalação para provisionar automaticamente.",
    };
  }

  const deployProject = (input.deployProject ?? "").trim();
  if (!deployProject) {
    return {
      ok: false,
      reason:
        "Informe o projeto de deploy da instalação para que o MASTER configure as variáveis automaticamente.",
    };
  }

  return { ok: true, projectRef, deployProject };
}

/* --------------------------------------------------- repositório da instalação */

export type InstallationRepo =
  | { ok: true; owner: string; repo: string; slug: string }
  | { ok: false; reason: string };

/**
 * Converte a URL do repositório cadastrada em `owner/repo`. Recusa qualquer
 * referência ao MASTER e o próprio repositório de referência do MASTER: o
 * código do MASTER é o TEMPLATE, nunca o destino da publicação.
 */
export function resolveInstallationRepo(input: {
  gitRepoUrl?: string | null;
  masterRepo?: string | null;
}): InstallationRepo {
  const raw = (input.gitRepoUrl ?? "").trim();
  if (!raw) {
    return {
      ok: false,
      reason:
        "Informe o repositório Git da instalação: o código do MASTER precisa ser publicado nele antes do deploy.",
    };
  }
  if (containsMasterReference(raw)) {
    return {
      ok: false,
      reason: "O repositório informado aponta para o MASTER — publicação recusada.",
    };
  }

  const withoutProtocol = raw
    .replace(/^git\+/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^git@/i, "")
    .replace(/^github\.com[:/]/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = withoutProtocol.split("/").filter(Boolean);
  const [owner, repo] = parts.length >= 2 ? [parts[0]!, parts[1]!] : ["", ""];
  const valid = /^[A-Za-z0-9._-]+$/;
  if (!owner || !repo || !valid.test(owner) || !valid.test(repo)) {
    return {
      ok: false,
      reason:
        "Repositório inválido: use o formato https://github.com/<conta>/<repositorio> no cadastro da instalação.",
    };
  }

  const slug = `${owner}/${repo}`;
  const master = (input.masterRepo ?? "").trim().toLowerCase();
  if (master && slug.toLowerCase() === master) {
    return {
      ok: false,
      reason:
        "O repositório da instalação é o mesmo do MASTER — a instalação precisa do seu próprio repositório.",
    };
  }

  return { ok: true, owner, repo, slug };
}



/* ---------------------------------------------------------------- secrets */

/** Secrets exclusivos gerados NO provisionamento, nunca herdados do MASTER. */
export const GENERATED_SECRET_VARS = [
  "CRON_SECRET",
  "BRAND_CREDENTIALS_SECRET",
  "META_STATE_SECRET",
  "META_WEBHOOK_VERIFY_TOKEN",
] as const;

export type GeneratedSecretVar = (typeof GENERATED_SECRET_VARS)[number];

export type SecretIsolation = { ok: true } | { ok: false; reason: string };

/**
 * Recusa qualquer reaproveitamento de secret do MASTER: valor idêntico ao do
 * ambiente do MASTER, valor com identificador do MASTER ou valor curto.
 */
export function assertSecretsAreExclusive(input: {
  generated: Partial<Record<GeneratedSecretVar, string>>;
  masterEnv: AutomationEnv;
}): SecretIsolation {
  for (const name of GENERATED_SECRET_VARS) {
    const value = (input.generated[name] ?? "").trim();
    if (!value) return { ok: false, reason: `${name} não foi gerado para a instalação.` };
    if (value.length < 32) {
      return { ok: false, reason: `${name} gerado é curto demais para a instalação.` };
    }
    if (containsMasterReference(value)) {
      return { ok: false, reason: `${name} contém identificador do MASTER.` };
    }
    const master = (input.masterEnv[name] ?? "").trim();
    if (master && master === value) {
      return { ok: false, reason: `${name} é o mesmo secret do MASTER — reuso proibido.` };
    }
  }
  return { ok: true };
}

/* -------------------------------------------------------- URL operacional */

export type ResolvedOperationalUrl =
  | { ok: true; origin: string; kind: OperationalUrlKind; source: "custom_domain" | "deploy" }
  | { ok: false; reason: string };

/**
 * Resolve a URL operacional: domínio definitivo quando existir, senão a URL
 * temporária do deploy. Sem nenhuma das duas o resultado é BLOCKED.
 */
export function resolveOperationalUrl(input: {
  customDomain?: string | null;
  deploymentUrl?: string | null;
}): ResolvedOperationalUrl {
  const custom = (input.customDomain ?? "").trim();
  if (custom) {
    // O cadastro apresenta o domínio como hostname (ex.: app.cliente.com.br),
    // enquanto PUBLIC_APP_URL exige uma URL HTTPS absoluta. Normalize somente
    // este metadado antes da validação; URLs com protocolo continuam literais.
    const normalizedCustom = /^https?:\/\//i.test(custom) ? custom : `https://${custom}`;
    const classified = classifyOperationalUrl(normalizedCustom);
    if (!classified.ok) return { ok: false, reason: classified.reason };
    if (classified.kind === "custom") {
      return { ok: true, origin: classified.origin, kind: "custom", source: "custom_domain" };
    }
  }

  const deployment = (input.deploymentUrl ?? "").trim();
  if (!deployment) {
    return {
      ok: false,
      reason:
        "Nenhuma URL operacional disponível: o deploy ainda não expôs uma URL e não há domínio definitivo.",
    };
  }
  const classified = classifyOperationalUrl(deployment);
  if (!classified.ok) return { ok: false, reason: classified.reason };
  return { ok: true, origin: classified.origin, kind: classified.kind, source: "deploy" };
}

/* ------------------------------------------------- variáveis do deploy */

export type DeployEnvEntry = { key: string; value: string; sensitive: boolean };

export type DeployEnvPlan =
  | { ok: true; entries: DeployEnvEntry[] }
  | { ok: false; reason: string };

/**
 * Plano de variáveis que o MASTER grava no projeto de deploy da instalação.
 * Só variáveis da PRÓPRIA instalação entram aqui.
 */
export function buildDeployEnvPlan(input: {
  appUrl: string;
  supabaseUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
  projectRef: string;
  secrets: Partial<Record<GeneratedSecretVar, string>>;
  /**
   * App Meta OFICIAL do Unitos (compartilhado entre instalações). Quando
   * disponível no MASTER, é propagado para a instalação nova: assim o modo
   * “Unitos — App Meta oficial” já vem resolvido, sem digitação na UI.
   */
  officialMetaApp?: {
    appId?: string | null;
    appSecret?: string | null;
    businessConfigId?: string | null;
  } | null;
}): DeployEnvPlan {
  const identity = `${input.appUrl} ${input.supabaseUrl} ${input.projectRef}`;
  if (containsMasterReference(identity)) {
    return { ok: false, reason: "As variáveis apontariam para o MASTER — plano recusado." };
  }
  const url = classifyOperationalUrl(input.appUrl);
  if (!url.ok) return { ok: false, reason: url.reason };

  const entries: DeployEnvEntry[] = [
    { key: "PUBLIC_APP_URL", value: url.origin, sensitive: false },
    { key: "VITE_PUBLIC_APP_URL", value: url.origin, sensitive: false },
    { key: "SUPABASE_URL", value: input.supabaseUrl, sensitive: false },
    { key: "VITE_SUPABASE_URL", value: input.supabaseUrl, sensitive: false },
    { key: "SUPABASE_PROJECT_ID", value: input.projectRef, sensitive: false },
    { key: "VITE_SUPABASE_PROJECT_ID", value: input.projectRef, sensitive: false },
    { key: "SUPABASE_PUBLISHABLE_KEY", value: input.publishableKey, sensitive: false },
    { key: "VITE_SUPABASE_PUBLISHABLE_KEY", value: input.publishableKey, sensitive: false },
    { key: "SUPABASE_SERVICE_ROLE_KEY", value: input.serviceRoleKey, sensitive: true },
  ];

  for (const name of GENERATED_SECRET_VARS) {
    const value = (input.secrets[name] ?? "").trim();
    if (!value) return { ok: false, reason: `${name} ausente no plano de variáveis.` };
    entries.push({ key: name, value, sensitive: true });
  }

  // App Meta oficial: credenciais compartilhadas do App central do Unitos +
  // Redirect URI da PRÓPRIA instalação. Sem elas o modo oficial fica pendente
  // (não é bloqueante: a instalação segue operacional).
  const metaAppId = (input.officialMetaApp?.appId ?? "").trim();
  const metaAppSecret = (input.officialMetaApp?.appSecret ?? "").trim();
  if (metaAppId && metaAppSecret) {
    entries.push({ key: "META_APP_ID", value: metaAppId, sensitive: false });
    entries.push({ key: "META_APP_SECRET", value: metaAppSecret, sensitive: true });
    const configId = (input.officialMetaApp?.businessConfigId ?? "").trim();
    if (configId) {
      entries.push({ key: "META_BUSINESS_CONFIG_ID", value: configId, sensitive: false });
    }
    entries.push({
      key: "META_REDIRECT_URI",
      value: `${url.origin}/api/public/meta/callback`,
      sensitive: false,
    });
  }

  const empty = entries.find((e) => !e.value.trim());
  if (empty) return { ok: false, reason: `Variável ${empty.key} sem valor — plano recusado.` };

  return { ok: true, entries };
}

/* -------------------------------------------------------- plano de etapas */

/**
 * Etapas do provisionamento automático. Os ids são os MESMOS de
 * `PROVISION_STEPS` para reaproveitar progresso, histórico e UI.
 */
export const AUTOMATED_PROVISION_PLAN = [
  { id: "supabase", label: "Supabase destino", detail: "Projeto, chaves e extensões" },
  { id: "code", label: "Código no GitHub", detail: "Repositório da instalação a partir do template" },
  { id: "deploy_link", label: "Deploy conectado", detail: "Projeto ligado ao repositório da instalação" },
  { id: "secrets", label: "Secrets próprios", detail: "Gerados e exclusivos da instalação" },
  { id: "deploy", label: "Variáveis + publicação", detail: "Variáveis e URL operacional" },
  { id: "database", label: "Banco + RLS + funções", detail: "Baseline aplicado no destino" },
  { id: "storage", label: "Storage", detail: "Buckets e policies" },
  { id: "seeds", label: "Seeds de catálogo", detail: "Catálogo, sem dado de negócio" },
  { id: "brain", label: "Brain stats", detail: "Materialized view inicializada" },
  { id: "cron", label: "Cron na própria origem", detail: "Agendado na URL operacional" },
  { id: "validation", label: "Validação final", detail: "verify-installation.sql" },
] as const;


export type AutomatedStepId = (typeof AUTOMATED_PROVISION_PLAN)[number]["id"];

export type AutomationOutcome = {
  result: "PASS" | "BLOCKED" | "FAIL";
  reasons: string[];
};

/** Recusa explícita: dependência externa indisponível nunca é sucesso. */
export function blockedOutcome(reasons: string[]): AutomationOutcome {
  return { result: "BLOCKED", reasons: reasons.length ? reasons : ["Pré-condição não satisfeita."] };
}

/** Resultado final do fluxo automatizado — nunca PASS com falhas/bloqueios. */
export function automationOutcome(input: {
  blocked?: string[];
  failures?: string[];
}): AutomationOutcome {
  const failures = input.failures ?? [];
  const blocked = input.blocked ?? [];
  if (failures.length) return { result: "FAIL", reasons: failures };
  if (blocked.length) return { result: "BLOCKED", reasons: blocked };
  return { result: "PASS", reasons: [] };
}
