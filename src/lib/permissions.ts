/**
 * Rótulos legados de permissão que ainda existem na coluna
 * `brand_members.permissions` / `brand_invites.permissions`.
 *
 * ATENÇÃO: nenhum deles tem enforcement — nem em RLS, nem em server
 * functions. O acesso real é decidido exclusivamente pelo PAPEL
 * (`brand_members.role` + `user_profiles.is_super_admin`), via
 * `app_access_role`, `is_brand_admin_level`, `has_brand_role` e
 * `can_access_client`. Estes IDs são mantidos apenas para validar/normalizar
 * dados históricos já gravados; não exiba-os como se fossem configuráveis.
 */
export type PermissionId =
  | "admin.full"
  | "pipelines.admin"
  | "pipelines.member"
  | "automations.manage"
  | "automations.logs"
  | "ai.edit"
  | "ai.analytics";

export const ALL_PERMISSION_IDS: PermissionId[] = [
  "admin.full",
  "pipelines.admin",
  "pipelines.member",
  "automations.manage",
  "automations.logs",
  "ai.edit",
  "ai.analytics",
];

export function normalizePermissions(input: unknown): PermissionId[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set<PermissionId>(ALL_PERMISSION_IDS);
  return input.filter(
    (v): v is PermissionId => typeof v === "string" && valid.has(v as PermissionId),
  );
}

/* ------------------------------------------------------------------ */
/* Access-Role Matrix (agency-wide RBAC)                              */
/* ------------------------------------------------------------------ */

/** Nível de acesso efetivo — derivado do papel do usuário na brand. */
export type AccessRole = "admin" | "user";

/**
 * Mapeia o papel bruto (brand_members.role: owner|manager|user|client)
 * para o nível de acesso global usado pela UI/rotas.
 * - owner/manager → admin (acesso irrestrito na marca)
 * - demais       → user  (colaborador escopado)
 */
export function resolveAccessRole(brandRole: string | null | undefined): AccessRole {
  const r = (brandRole ?? "").toLowerCase();
  return r === "owner" || r === "manager" || r === "admin" ? "admin" : "user";
}

export const isAdminRole = (role: AccessRole | null | undefined) => role === "admin";

/** URLs permitidas na sidebar por nível de acesso. */
export const SIDEBAR_ALLOWED_URLS: Record<AccessRole, ReadonlySet<string>> = {
  admin: new Set([
    "/dashboard",
    "/tasks",
    "/calendar",
    "/projects",
    "/customers",
    "/analytics",
    "/media-plans",
    "/connections",
    "/agents",
    "/content",
    "/monthly-plan",
    "/brain",
    "/chat",
    "/settings/team",
    "/notifications",
    "/settings",
  ]),
  user: new Set([
    "/dashboard",
    "/tasks",
    "/calendar",
    "/projects",
    "/customers",
    "/content",
    "/monthly-plan",
    "/media-plans",
    "/brain",
    "/chat",
    "/notifications",
  ]),
};

export const canAccessSidebarUrl = (role: AccessRole, url: string) =>
  SIDEBAR_ALLOWED_URLS[role].has(url);

/** Dados básicos do cliente — apenas admin edita. */
export const canEditBasicInfo = (role: AccessRole) => role === "admin";

/** Rota de fallback quando o usuário tenta acessar um cliente/rota fora do escopo. */
export const FALLBACK_ROUTE: Record<AccessRole, string> = {
  admin: "/dashboard",
  user: "/dashboard",
};

/* ------------------------------------------------------------------ */
/* Autoridade por área (fonte única para gating de UI)                */
/* ------------------------------------------------------------------ */

import type { AuthorityRole } from "@/lib/access-guard";

/**
 * Integrações (Meta/Instagram/Facebook/WhatsApp/Ads, portfólios, contas,
 * ativos, vínculos e sincronização): SUPER ADMIN e ADMIN (owner→admin).
 * MANAGER **não** tem autoridade de integração.
 * Espelha `public.is_brand_integration_authority`.
 */
export const canManageIntegrations = (role: AuthorityRole | null | undefined) =>
  role === "super_admin" || role === "admin";

/**
 * Administração do Cliente (Recursos, Identidade, Ambiente): SOMENTE
 * SUPER ADMIN — nunca ADMIN. Espelha `assertSuperAdmin` no servidor e
 * `is_super_admin(auth.uid())` na RLS.
 */
export const canAccessClientAdmin = (role: AuthorityRole | null | undefined) =>
  role === "super_admin";
