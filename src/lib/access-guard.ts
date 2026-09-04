/**
 * Fase 1 RBAC — resolução canônica de papel/escopo compartilhada por
 * server functions. NÃO contém segredos: recebe o client Supabase do
 * chamador (autenticado, RLS aplicada) e apenas consulta as funções
 * canônicas do banco (`app_access_role`, `can_access_client`).
 *
 * Regra arquitetural: ROLE define autoridade, ESCOPO define onde.
 */

import { callRpc, type RpcCapableClient } from "@/lib/supabase-rpc";

export type AuthorityRole = "super_admin" | "admin" | "manager" | "user" | "client";

export const AUTHORITY_ROLES: readonly AuthorityRole[] = [
  "super_admin",
  "admin",
  "manager",
  "user",
  "client",
];

/** Papéis com autoridade administrativa dentro da marca. */
export const ADMIN_LEVEL_ROLES: readonly AuthorityRole[] = ["super_admin", "admin", "manager"];

export const isAuthorityRole = (v: unknown): v is AuthorityRole =>
  typeof v === "string" && (AUTHORITY_ROLES as readonly string[]).includes(v);

/** Aceita qualquer client Supabase (tipado ou não) — só usamos `rpc`. */
export type RpcClient = RpcCapableClient;

/**
 * Papel canônico do usuário na marca (fonte única: `app_access_role`).
 *
 * `brandId` nulo NÃO resolve papel interno: o banco deixou de escolher o
 * "melhor papel entre marcas" (Fase 1 RBAC). Sem workspace só existe
 * `super_admin` (autoridade global) ou `client` (Portal).
 */
export async function resolveAuthorityRole(
  supabase: RpcClient,
  userId: string,
  brandId?: string | null,
): Promise<AuthorityRole | null> {
  const { data, error } = await callRpc(supabase, "app_access_role", {
    _user_id: userId,
    _brand_id: brandId ?? null,
  });
  if (error) throw error;
  return isAuthorityRole(data) ? data : null;
}

/**
 * Exige papel administrativo na marca.
 *
 * ATENÇÃO: `admin` = todo o workspace; `manager` tem autoridade
 * administrativa mas escopo de DADOS limitado aos clientes atribuídos —
 * operações sobre um cliente específico exigem `assertClientScope` além
 * deste guard.
 */
export async function assertBrandAdmin(
  supabase: RpcClient,
  userId: string,
  brandId: string,
  opts: { allowManager?: boolean } = {},
): Promise<AuthorityRole> {
  if (!brandId) throw new Error("Forbidden: workspace obrigatório");
  const role = await resolveAuthorityRole(supabase, userId, brandId);
  const allowed: readonly AuthorityRole[] =
    opts.allowManager === false ? ["super_admin", "admin"] : ADMIN_LEVEL_ROLES;
  if (!role || !allowed.includes(role)) {
    throw new Error("Forbidden: papel insuficiente para esta operação");
  }
  return role;
}

/**
 * Exige autoridade administrativa (super_admin/admin/manager) DENTRO de um
 * workspace. `brandId` é obrigatório: não existe autoridade administrativa
 * "global" fora do super admin.
 */
export async function assertAdminAuthority(
  supabase: RpcClient,
  userId: string,
  brandId: string,
): Promise<AuthorityRole> {
  return assertBrandAdmin(supabase, userId, brandId);
}

/* ------------------------------------------------------------------ */
/* Autoridade de INTEGRAÇÃO (Meta/Instagram/Facebook/WhatsApp/Ads)     */
/* ------------------------------------------------------------------ */

/**
 * Autoridade de integração = SUPER ADMIN, OWNER ou ADMIN do workspace.
 *
 * MANAGER **não** entra: `is_brand_admin_level` (RLS legada) incluía manager e
 * divergia da regra de produto. A fonte canônica única — usada tanto pela RLS
 * quanto pelo servidor — é `public.is_brand_integration_authority`.
 */
export async function hasIntegrationAuthority(
  supabase: RpcClient,
  userId: string,
  brandId: string,
): Promise<boolean> {
  if (!brandId) return false;
  const { data, error } = await callRpc(supabase, "is_brand_integration_authority", {
    _brand_id: brandId,
    _user_id: userId,
  });
  if (error) return false;
  return data === true;
}

/** Defesa em profundidade: exige autoridade de integração antes de qualquer
 * leitura/escrita de autorização, portfólio, contas ou vínculos. */
export async function assertIntegrationAuthority(
  supabase: RpcClient,
  userId: string,
  brandId: string,
): Promise<void> {
  if (!(await hasIntegrationAuthority(supabase, userId, brandId))) {
    throw new Error(
      "Apenas Owner, Admin ou Super Admin podem gerenciar integrações deste workspace.",
    );
  }
}



/**
 * Exige que o ator possa CONCEDER `role` na marca — fonte canônica única:
 * `public.can_invite_brand_role()` (mesma matriz usada por `brand_invites`).
 *
 * Usar SEMPRE antes de qualquer escrita administrativa em `brand_members`,
 * inclusive quando a escrita final usar o client de service role (que bypassa
 * RLS). Não cria hierarquia paralela: apenas consulta a função canônica.
 */
export async function assertCanGrantBrandRole(
  supabase: RpcClient,
  actorId: string,
  brandId: string,
  role: string,
  email: string,
): Promise<void> {
  const { data, error } = await callRpc(supabase, "can_invite_brand_role", {
    _brand_id: brandId,
    _actor_id: actorId,
    _role: role,
    _email: email,
  });
  if (error) throw error;
  if (data !== true) {
    throw new Error("forbidden: papel insuficiente para conceder este nível de acesso");
  }
}

/** Papéis de membership em `brand_members` (Portal usa `client`). */
export type BrandMemberRole = "owner" | "admin" | "manager" | "user" | "client";

/**
 * Matriz canônica de concessão (espelha `public.can_invite_brand_role`):
 *   super_admin → owner | admin | manager | user
 *   admin (owner OU admin da marca) → admin | manager | user  (nunca owner)
 *   manager → user
 *   user/client → nenhum
 */
export function grantableBrandRoles(
  authorityRole: AuthorityRole | null | undefined,
): BrandMemberRole[] {
  if (authorityRole === "super_admin") return ["owner", "admin", "manager", "user"];
  if (authorityRole === "admin") return ["admin", "manager", "user"];
  if (authorityRole === "manager") return ["user"];
  return [];
}

/** Papel de membership bruto do usuário na marca (owner ≠ admin). */
export async function resolveBrandMemberRole(
  supabase: RpcClient,
  userId: string,
  brandId: string,
): Promise<BrandMemberRole | null> {
  const { data, error } = await callRpc(supabase, "brand_member_role", {
    _user_id: userId,
    _brand_id: brandId,
  });
  if (error) throw error;
  const roles: readonly string[] = ["owner", "admin", "manager", "user", "client"];
  return typeof data === "string" && roles.includes(data) ? (data as BrandMemberRole) : null;
}

/**
 * Exige autoridade para ATRIBUIR/ALTERAR o papel de um membro existente.
 * Complementa `assertCanGrantBrandRole` (que exige e-mail) para operações de
 * edição/remoção: valida também o papel ATUAL do alvo, para que Admin não
 * altere Owner e Manager só mexa em User.
 */
export async function assertCanManageBrandMember(
  supabase: RpcClient,
  actorId: string,
  brandId: string,
  targetUserId: string,
  nextRole?: BrandMemberRole | null,
): Promise<AuthorityRole> {
  const authority = await resolveAuthorityRole(supabase, actorId, brandId);
  if (authority === "super_admin") return authority;
  const grantable = grantableBrandRoles(authority);
  if (grantable.length === 0) {
    throw new Error("forbidden: papel insuficiente para gerenciar membros");
  }
  if (nextRole && !grantable.includes(nextRole)) {
    throw new Error(
      nextRole === "owner"
        ? "forbidden: somente super admin pode conceder Owner"
        : "forbidden: papel insuficiente para conceder este nível de acesso",
    );
  }
  const targetRole = await resolveBrandMemberRole(supabase, targetUserId, brandId);
  if (targetRole === "owner") {
    throw new Error("forbidden: somente super admin pode alterar o Owner da marca");
  }
  if (authority === "manager" && targetRole && targetRole !== "user") {
    throw new Error("forbidden: gerente gerencia apenas membros User");
  }
  return authority as AuthorityRole;
}


/**
 * Exige que o usuário PERTENÇA ao workspace (qualquer papel interno) — fonte
 * canônica `app_access_role`. Usar antes de qualquer operação privilegiada
 * (supabaseAdmin/config de IA) que receba `brandId` do frontend: sem isto o
 * ID enviado pelo cliente seria a única "autorização".
 */
export async function assertBrandMember(
  supabase: RpcClient,
  userId: string,
  brandId: string,
): Promise<AuthorityRole> {
  if (!brandId) throw new Error("Forbidden: workspace obrigatório");
  const role = await resolveAuthorityRole(supabase, userId, brandId);
  const allowed: readonly AuthorityRole[] = ["super_admin", "admin", "manager", "user"];
  if (!role || !allowed.includes(role)) {
    throw new Error("Forbidden: você não pertence a este workspace");
  }
  return role;
}

/**
 * Bloqueia pares cross-workspace forjados (`brandId` de A + `clientId` de B):
 * o cliente precisa existir DENTRO do workspace informado e no escopo do
 * usuário (a leitura passa pela RLS de `clients`).
 */
export async function assertClientInBrand(
  supabase: RpcClient & { from: unknown },
  userId: string,
  brandId: string,
  clientId: string,
): Promise<void> {
  await assertClientScope(supabase, userId, clientId);
  const q = (supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => {
          eq: (k: string, v: string) => {
            maybeSingle: () => Promise<{ data: { id: string } | null; error: unknown }>;
          };
        };
      };
    };
  }).from("clients");
  const { data, error } = await q.select("id").eq("id", clientId).eq("brand_id", brandId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Forbidden: cliente não pertence a este workspace");
}

/** Exige que o cliente esteja no escopo do usuário (mesma regra da RLS). */
export async function assertClientScope(
  supabase: RpcClient,
  userId: string,
  clientId: string,
): Promise<void> {
  const { data, error } = await callRpc(supabase, "can_access_client", {
    _client_id: clientId,
    _user_id: userId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Forbidden: cliente fora do seu escopo");
}

/**
 * Exige que o PROJETO esteja no escopo do usuário — herança
 * workspace → cliente → projeto (fonte canônica: `can_access_project`).
 *
 * Use sempre que uma server function receber `projectId` do frontend antes de
 * qualquer leitura/escrita privilegiada.
 */
export async function assertProjectScope(
  supabase: RpcClient,
  userId: string,
  projectId: string,
): Promise<void> {
  const { data, error } = await callRpc(supabase, "can_access_project", {
    _project_id: projectId,
    _user_id: userId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Forbidden: projeto fora do seu escopo");
}

/**
 * Exige que a TAREFA esteja no escopo do usuário — herança
 * workspace → cliente → projeto → tarefa (fonte canônica: `can_access_task`).
 */
export async function assertTaskScope(
  supabase: RpcClient,
  userId: string,
  taskId: string,
): Promise<void> {
  const { data, error } = await callRpc(supabase, "can_access_task", {
    _task_id: taskId,
    _user_id: userId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Forbidden: tarefa fora do seu escopo");
}


/* ------------------------------------------------------------------ */
/* Escopo de clientes (contexto canônico)                             */
/* ------------------------------------------------------------------ */

export type AccessScope = {
  /** Workspace consultado. */
  brandId: string | null;
  role: AuthorityRole | null;
  /**
   * Clientes que o usuário pode acessar no workspace.
   * `null` = autoridade total no workspace (admin/super_admin) — NUNCA
   * significa "nenhum". Lista vazia = nenhum cliente atribuído.
   */
  allowedClientIds: string[] | null;
};

type MyAccessRow = {
  role?: unknown;
  client_ids?: unknown;
  is_super_admin?: unknown;
};

/**
 * Fonte ÚNICA de escopo server-side: espelha `public.my_access` (mesma regra
 * de `can_access_client_row`). Use antes de qualquer agregação por workspace
 * para não vazar clientes fora do escopo do usuário.
 *
 * - `super_admin` / `admin` do workspace → `allowedClientIds = null` (tudo).
 * - `manager` / `user` → lista explícita de clientes atribuídos.
 */
export async function resolveAccessScope(
  supabase: RpcClient,
  brandId: string | null,
): Promise<AccessScope> {
  const { data, error } = await callRpc(supabase, "my_access", { _brand_id: brandId ?? null });
  if (error) throw error;
  const row = (data ?? {}) as MyAccessRow;
  const role = isAuthorityRole(row.role) ? row.role : null;
  const clientIds = Array.isArray(row.client_ids)
    ? row.client_ids.filter((v): v is string => typeof v === "string")
    : [];
  const isFullAuthority = role === "super_admin" || role === "admin";
  return { brandId: brandId ?? null, role, allowedClientIds: isFullAuthority ? null : clientIds };
}

/**
 * Resolve a lista de clientes a considerar em uma agregação.
 *
 * - `requestedClientId` informado → valida escopo e devolve só ele.
 * - Sem cliente selecionado → devolve `null` para admin (todo o workspace)
 *   ou a lista atribuída para manager/user.
 *
 * Lança quando o cliente pedido está fora do escopo (nunca degrada
 * silenciosamente para "todos").
 */
export async function resolveScopedClientIds(
  supabase: RpcClient,
  brandId: string | null,
  requestedClientId?: string | null,
): Promise<string[] | null> {
  const scope = await resolveAccessScope(supabase, brandId);
  if (requestedClientId) {
    if (scope.allowedClientIds && !scope.allowedClientIds.includes(requestedClientId)) {
      throw new Error("Forbidden: cliente fora do seu escopo");
    }
    return [requestedClientId];
  }
  return scope.allowedClientIds;
}


/* ------------------------------------------------------------------ */
/* Permissões por MÓDULO (RBAC operacional)                           */
/* ------------------------------------------------------------------ */

import {
  mergeModulePermissions,
  type ModuleKey,
  type ModuleLevel,
  type ModulePermissions,
} from "@/lib/module-permissions";

/**
 * Permissões efetivas do usuário no workspace — espelha
 * `public.effective_module_permissions` (perfil + overrides; admins → tudo).
 */
export async function resolveModulePermissions(
  supabase: RpcClient,
  userId: string,
  brandId: string,
): Promise<ModulePermissions> {
  const { data, error } = await callRpc(supabase, "effective_module_permissions", {
    _user_id: userId,
    _brand_id: brandId,
  });
  if (error) throw error;
  return mergeModulePermissions(data, null);
}

/**
 * Defesa em profundidade: exige nível mínimo no módulo antes de qualquer
 * escrita. NÃO substitui o gate de escopo por cliente (`assertClientScope`).
 */
export async function assertModuleAccess(
  supabase: RpcClient,
  userId: string,
  brandId: string,
  moduleKey: ModuleKey,
  minLevel: ModuleLevel = "view",
): Promise<void> {
  if (!brandId) throw new Error("Forbidden: workspace obrigatório");
  const { data, error } = await callRpc(supabase, "has_module_access", {
    _user_id: userId,
    _brand_id: brandId,
    _module: moduleKey,
    _min_level: minLevel,
  });
  if (error || data !== true) {
    throw new Error(`Forbidden: sem permissão suficiente no módulo ${moduleKey}`);
  }
}
