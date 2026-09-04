/**
 * Permissões por MÓDULO (RBAC operacional).
 *
 * Fonte ÚNICA compartilhada por UI e servidor. Espelha exatamente o que o
 * banco calcula em `public.effective_module_permissions` /
 * `public.has_module_access`:
 *
 *  - ROLE define autoridade: super_admin/owner/admin/manager → tudo `full`.
 *  - Para `user` (operação) o nível vem do PERFIL DE ACESSO
 *    (`access_profiles.permissions`) sobrescrito campo a campo por
 *    `brand_members.module_permissions`.
 *  - ESCOPO por cliente continua valendo por cima (owner_user_id /
 *    client_members). Permissão diz O QUE; escopo diz ONDE.
 */

export const MODULE_LEVELS = ["none", "view", "own", "full"] as const;
export type ModuleLevel = (typeof MODULE_LEVELS)[number];

export const isModuleLevel = (v: unknown): v is ModuleLevel =>
  typeof v === "string" && (MODULE_LEVELS as readonly string[]).includes(v);

export const MODULE_LEVEL_RANK: Record<ModuleLevel, number> = {
  none: 0,
  view: 1,
  own: 2,
  full: 3,
};

export const MODULE_LEVEL_LABEL: Record<ModuleLevel, string> = {
  none: "Nenhum",
  view: "Ver",
  own: "Ver + Próprios registros",
  full: "Total",
};

export const MODULE_LEVEL_HINT: Record<ModuleLevel, string> = {
  none: "O módulo não aparece no menu e nenhuma ação é permitida.",
  view: "Somente leitura dos registros no escopo do usuário.",
  own: "Lê todos os registros do escopo e cria, altera ou remove apenas os próprios (criados por ele ou em que está envolvido).",
  full: "Cria, altera e remove qualquer registro dentro do escopo do usuário.",
};

export const MODULE_KEYS = [
  "clients",
  "briefing",
  "projects",
  "tasks",
  "planning",
  "content",
  "calendar",
  "approvals",
  "media_plans",
  "connections",
  "reports",
  "users",
  "settings",
  "ai",
  "brain",
  "chat",
  "portal",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const isModuleKey = (v: unknown): v is ModuleKey =>
  typeof v === "string" && (MODULE_KEYS as readonly string[]).includes(v);

export type ModuleGroup = "Operação" | "Conteúdo & Mídia" | "Inteligência" | "Administração";

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;
  group: ModuleGroup;
  description: string;
  /** Rotas da sidebar liberadas quando o nível é >= `view`. */
  urls: string[];
  /** Módulos que só fazem sentido com Nenhum/Ver/Total (sem "próprios"). */
  levels?: ModuleLevel[];
};

export const MODULES: ModuleDefinition[] = [
  {
    key: "clients",
    label: "Clientes",
    group: "Operação",
    description: "Cadastro de clientes atendidos pela agência.",
    urls: ["/customers"],
  },
  {
    key: "briefing",
    label: "Briefing",
    group: "Operação",
    description: "Briefing do cliente, importação por IA e histórico.",
    urls: [],
  },
  {
    key: "projects",
    label: "Projetos",
    group: "Operação",
    description: "Projetos, etapas e participantes.",
    urls: ["/projects"],
  },
  {
    key: "tasks",
    label: "Tarefas",
    group: "Operação",
    description: "Tarefas, subtarefas, comentários e apontamento de horas.",
    urls: ["/tasks"],
  },
  {
    key: "calendar",
    label: "Calendário",
    group: "Operação",
    description: "Agenda de publicações, reuniões e prazos.",
    urls: ["/calendar"],
  },
  {
    key: "planning",
    label: "Planejamento e Pautas",
    group: "Conteúdo & Mídia",
    description: "Planejamento mensal, pautas e geração por IA.",
    urls: ["/monthly-plan"],
  },
  {
    key: "content",
    label: "Conteúdo e Posts",
    group: "Conteúdo & Mídia",
    description: "Produção de posts, criativos e agendamento.",
    urls: ["/content"],
  },
  {
    key: "approvals",
    label: "Aprovações",
    group: "Conteúdo & Mídia",
    description: "Fluxo de aprovação interna e do cliente.",
    urls: [],
  },
  {
    key: "media_plans",
    label: "Planos de mídia",
    group: "Conteúdo & Mídia",
    description: "Planos de mídia, verbas e distribuição.",
    urls: ["/media-plans"],
  },
  {
    key: "reports",
    label: "Relatórios",
    group: "Conteúdo & Mídia",
    description: "Indicadores e relatórios de desempenho.",
    urls: ["/analytics"],
    levels: ["none", "view", "full"],
  },
  {
    key: "ai",
    label: "IA e agentes",
    group: "Inteligência",
    description: "Uso dos agentes de IA e configuração de prompts.",
    urls: ["/agents"],
  },
  {
    key: "brain",
    label: "Brain",
    group: "Inteligência",
    description: "Memória e recomendações do Brain.",
    urls: ["/brain"],
    levels: ["none", "view", "full"],
  },
  {
    key: "chat",
    label: "Chat",
    group: "Inteligência",
    description: "Conversas internas e com a IA.",
    urls: ["/chat"],
  },
  {
    key: "connections",
    label: "Conexões e canais",
    group: "Administração",
    description: "Contas Meta/Instagram/WhatsApp e vínculo de canais a clientes.",
    urls: ["/connections"],
    levels: ["none", "view", "full"],
  },
  {
    key: "portal",
    label: "Portal do cliente",
    group: "Administração",
    description: "Acessos do portal e links de aprovação do cliente.",
    urls: [],
    levels: ["none", "view", "full"],
  },
  {
    key: "users",
    label: "Usuários e permissões",
    group: "Administração",
    description: "Adicionar usuários, definir perfis e permissões.",
    urls: ["/settings/team", "/settings/permissions"],
    levels: ["none", "view", "full"],
  },
  {
    key: "settings",
    label: "Configurações do workspace",
    group: "Administração",
    description: "Identidade, SLA, limites de IA e demais configurações.",
    urls: ["/settings"],
    levels: ["none", "view", "full"],
  },
];

export const MODULE_BY_KEY: Record<ModuleKey, ModuleDefinition> = MODULES.reduce(
  (acc, m) => {
    acc[m.key] = m;
    return acc;
  },
  {} as Record<ModuleKey, ModuleDefinition>,
);

export const MODULE_GROUPS: ModuleGroup[] = [
  "Operação",
  "Conteúdo & Mídia",
  "Inteligência",
  "Administração",
];

export const levelsForModule = (key: ModuleKey): ModuleLevel[] =>
  MODULE_BY_KEY[key]?.levels ?? [...MODULE_LEVELS];

export type ModulePermissions = Record<ModuleKey, ModuleLevel>;
export type PartialModulePermissions = Partial<Record<ModuleKey, ModuleLevel>>;

export const emptyModulePermissions = (): ModulePermissions =>
  MODULE_KEYS.reduce((acc, k) => {
    acc[k] = "none";
    return acc;
  }, {} as ModulePermissions);

export const fullModulePermissions = (): ModulePermissions =>
  MODULE_KEYS.reduce((acc, k) => {
    acc[k] = "full";
    return acc;
  }, {} as ModulePermissions);

/** Normaliza JSON vindo do banco, descartando chaves/níveis desconhecidos. */
export function normalizeModulePermissions(input: unknown): PartialModulePermissions {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: PartialModulePermissions = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!isModuleKey(k) || !isModuleLevel(v)) continue;
    const allowed = levelsForModule(k);
    out[k] = allowed.includes(v) ? v : "none";
  }
  return out;
}

/** Perfil + ajustes individuais → mapa completo (chaves ausentes = `none`). */
export function mergeModulePermissions(
  profile: unknown,
  override: unknown,
): ModulePermissions {
  const base = normalizeModulePermissions(profile);
  const over = normalizeModulePermissions(override);
  return MODULE_KEYS.reduce((acc, k) => {
    acc[k] = over[k] ?? base[k] ?? "none";
    return acc;
  }, {} as ModulePermissions);
}

/** True quando existe pelo menos um módulo diferente do perfil. */
export function hasCustomOverrides(profile: unknown, override: unknown): boolean {
  const base = normalizeModulePermissions(profile);
  const over = normalizeModulePermissions(override);
  return MODULE_KEYS.some((k) => over[k] !== undefined && over[k] !== (base[k] ?? "none"));
}

/** Somente os módulos realmente divergentes do perfil (o que persistimos). */
export function diffFromProfile(
  profile: unknown,
  desired: PartialModulePermissions,
): PartialModulePermissions {
  const base = normalizeModulePermissions(profile);
  const want = normalizeModulePermissions(desired);
  const out: PartialModulePermissions = {};
  for (const k of MODULE_KEYS) {
    const level = want[k] ?? "none";
    if (level !== (base[k] ?? "none")) out[k] = level;
  }
  return out;
}

export const atLeast = (level: ModuleLevel | undefined, min: ModuleLevel): boolean =>
  MODULE_LEVEL_RANK[level ?? "none"] >= MODULE_LEVEL_RANK[min];

export type ModuleAction = "view" | "createOwn" | "createAny";

/** Helper de UI: `can(perms, "projects", "createAny")`. */
export function can(
  perms: PartialModulePermissions | ModulePermissions | null | undefined,
  moduleKey: ModuleKey,
  action: ModuleAction = "view",
): boolean {
  const level = perms?.[moduleKey] ?? "none";
  if (action === "view") return atLeast(level, "view");
  if (action === "createOwn") return atLeast(level, "own");
  return atLeast(level, "full");
}

/** Rótulo do perfil na UI — "Atendimento (personalizado)" quando há ajustes. */
export function profileLabel(
  profileName: string | null | undefined,
  customized: boolean,
): string {
  const base = (profileName ?? "").trim() || "Sem perfil";
  return customized ? `${base} (personalizado)` : base;
}

/** Rotas da sidebar liberadas pelas permissões efetivas. */
export function allowedSidebarUrls(
  perms: PartialModulePermissions | ModulePermissions | null | undefined,
): Set<string> {
  const urls = new Set<string>(["/dashboard", "/notifications"]);
  for (const m of MODULES) {
    if (!can(perms, m.key, "view")) continue;
    for (const u of m.urls) urls.add(u);
  }
  return urls;
}
