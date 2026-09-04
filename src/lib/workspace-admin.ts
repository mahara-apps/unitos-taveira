/**
 * Ações administrativas do WORKSPACE (= `brands`, identidade da instalação).
 *
 * Fonte ÚNICA da matriz usada pela UI. Não concede autorização: o servidor
 * (`assertBrandAdmin` / `can_delete_brand` + RLS) segue sendo a autoridade.
 *
 * Matriz canônica:
 *   super_admin → editar, configurar, membros, EXCLUIR
 *   owner       → editar, configurar, membros, EXCLUIR (o próprio workspace)
 *   admin       → editar, configurar, membros (NUNCA excluir)
 *   manager     → nada
 *   user/client → nada
 */
import type { AuthorityRole, BrandMemberRole } from "@/lib/access-guard";

export type WorkspaceAdminActions = {
  canEdit: boolean;
  canConfigure: boolean;
  canManageMembers: boolean;
  canDelete: boolean;
  /** true quando existe pelo menos uma ação — o menu só aparece nesse caso. */
  hasAny: boolean;
};

const NONE: WorkspaceAdminActions = {
  canEdit: false,
  canConfigure: false,
  canManageMembers: false,
  canDelete: false,
  hasAny: false,
};

export function workspaceAdminActions(
  authorityRole: AuthorityRole | null | undefined,
  brandRole: BrandMemberRole | string | null | undefined,
): WorkspaceAdminActions {
  const isSuperAdmin = authorityRole === "super_admin" || brandRole === "super_admin";
  const isOwner = brandRole === "owner";
  // `admin` textual cobre owner/admin da marca; `manager` também retorna
  // `admin` como autoridade em algumas leituras, por isso o papel bruto manda.
  const isBrandAdmin = brandRole === "admin" || (authorityRole === "admin" && !isOwner);

  if (isSuperAdmin) {
    return {
      canEdit: true,
      canConfigure: true,
      canManageMembers: true,
      canDelete: true,
      hasAny: true,
    };
  }
  if (isOwner) {
    return {
      canEdit: true,
      canConfigure: true,
      canManageMembers: true,
      canDelete: true,
      hasAny: true,
    };
  }
  if (isBrandAdmin) {
    return {
      canEdit: true,
      canConfigure: true,
      canManageMembers: true,
      canDelete: false,
      hasAny: true,
    };
  }
  return NONE;
}

/** Confirmação de exclusão: exige o nome exato do workspace (case-insensitive, trim). */
export function isDeleteConfirmationValid(
  typed: string,
  workspaceName: string | null | undefined,
): boolean {
  if (!workspaceName) return false;
  return typed.trim().toLowerCase() === workspaceName.trim().toLowerCase();
}

/**
 * Identidade visual (logos/ícone/white label) é EXCLUSIVA de Super Admin:
 * visualização, aba e edição. Owner/Admin/Manager/User não veem a aba nem
 * acessam por URL direta. Fonte única do gate de UI — a autorização real fica
 * em `updateBrandBranding` (assertSuperAdmin) e nas server functions de
 * Administração do ambiente.
 */
export function canAccessVisualIdentity(isSuperAdmin: boolean | null | undefined): boolean {
  return isSuperAdmin === true;
}
