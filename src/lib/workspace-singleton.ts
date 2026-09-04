/**
 * Workspace é SINGLETON da instalação.
 *
 * Regras puras compartilhadas por UI, server functions e testes. Nada aqui
 * concede acesso: a barreira real é o banco (`can_create_brand` +
 * trigger `enforce_single_brand`).
 */

export const SINGLE_WORKSPACE_ERROR =
  "Esta instalação já possui um workspace. O Unitos opera com 1 workspace por instalação.";

/** Só é possível criar workspace quando a instalação ainda não tem nenhum. */
export function canCreateWorkspace(existingWorkspaceCount: number): boolean {
  return existingWorkspaceCount === 0;
}

/** A UI de troca/seleção de workspace nunca é exibida no modelo singleton. */
export function shouldShowWorkspaceSwitcher(): boolean {
  return false;
}

/**
 * Workspace ativo resolvido pelo contexto da instalação: existe no máximo um,
 * então ele é sempre o primeiro (e único) da lista.
 */
export function resolveInstallationWorkspaceId(
  workspaceIds: readonly string[] | null | undefined,
): string | null {
  if (!workspaceIds || workspaceIds.length === 0) return null;
  return workspaceIds[0] ?? null;
}

/** Invariante da instalação: nunca mais de um workspace. */
export function assertSingleWorkspace(workspaceIds: readonly string[]): void {
  if (workspaceIds.length > 1) {
    throw new Error(SINGLE_WORKSPACE_ERROR);
  }
}
