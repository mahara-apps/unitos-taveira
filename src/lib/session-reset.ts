import type { QueryClient } from "@tanstack/react-query";
import { clearCachedUser } from "@/lib/auth-cache";
import { clearAccessCaches } from "@/lib/access-cache";
import { markActiveWorkspaceUnresolved } from "@/lib/active-workspace";
import { clearSocialSnapshot } from "@/lib/query-persistence";

/**
 * Fase 7 — higiene de estado local em transições de identidade.
 *
 * O cache do React Query usa `keepPreviousData` globalmente (performance):
 * sem limpeza explícita, dados do usuário/escopo anterior continuam visíveis
 * durante o primeiro fetch da nova identidade. Nada de autorização depende
 * disto (servidor/RLS seguem sendo a autoridade) — é isolamento de UI.
 */
export function resetIdentityState(queryClient: QueryClient): void {
  void queryClient.cancelQueries();
  queryClient.clear();
  clearCachedUser();
  clearAccessCaches();
  // O workspace volta a "indefinido": o feature gate aguarda a reconstrução do
  // contexto em vez de concluir que não existe workspace/plano.
  markActiveWorkspaceUnresolved();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("nx:identity-reset"));
    try {
      window.localStorage.removeItem("nx.brand");
      window.localStorage.removeItem("nx.client");
    } catch {
      /* storage indisponível — sem impacto funcional */
    }
    clearSocialSnapshot();
  }
}

/**
 * Chaves de cache que NÃO dependem do workspace/cliente ativo: identidade do
 * usuário, lista de workspaces e flags globais. Trocar de workspace não pode
 * derrubá-las (isso forçava refetch de tudo e prolongava o boot).
 */
export const WORKSPACE_STABLE_QUERY_KEYS = new Set<string>([
  "brands",
  "dashboard-greeting",
  "me-is-super-admin",
  "portal-access",
]);

/** true quando a query depende do escopo (workspace/cliente) e deve ser descartada. */
export function isWorkspaceScopedQueryKey(queryKey: readonly unknown[] | undefined): boolean {
  const first = queryKey?.[0];
  if (typeof first !== "string") return true;
  return !WORKSPACE_STABLE_QUERY_KEYS.has(first);
}

/**
 * `SIGNED_IN` do Supabase também é emitido quando a sessão do MESMO usuário é
 * restaurada/renovada. Só é troca de identidade quando o usuário muda de fato
 * (ou quando houve logout).
 */
export function isIdentityChange(
  event: string,
  previousUserId: string | null,
  nextUserId: string | null,
): boolean {
  if (event === "SIGNED_OUT") return true;
  if (!nextUserId) return true;
  if (!previousUserId) return false;
  return previousUserId !== nextUserId;
}

/** true quando a chave de query já carrega algum id de escopo (brand/cliente). */
export function queryKeyCarriesScopeId(
  queryKey: readonly unknown[] | undefined,
  scopeIds: readonly (string | null)[],
): boolean {
  const ids = scopeIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return false;
  return (queryKey ?? []).some((part) => typeof part === "string" && ids.includes(part));
}

/**
 * Troca de workspace/cliente — SINCRONA e NÃO destrutiva.
 *
 * O cache é isolado por `userId + brandId + clientId` nas próprias chaves, então
 * a troca não precisa (e não pode) esperar nada: `cancelQueries()` + `removeQueries()`
 * globais cancelavam justamente as queries do novo cliente que acabaram de iniciar,
 * forçando refetch em cascata (a espera de 15–20s percebida no seletor) e destruindo
 * o cache do cliente anterior (X → Y → X deixava de ser instantâneo).
 *
 * Aqui apenas marcamos como obsoletas as queries de escopo cuja chave NÃO carrega
 * o id de brand/cliente — essas revalidam em background. Nada é aguardado.
 */
export function resetScopeCache(
  queryClient: QueryClient,
  scopeIds: readonly (string | null)[] = [],
): void {
  queryClient.invalidateQueries({
    // `refetchType: "none"`: marcar como obsoleto NÃO pode disparar uma rajada de
    // refetch concorrente com as queries do novo cliente (elas competiam pelas
    // mesmas conexões/worker e a troca parecia travada). Cada query revalida no
    // próprio ciclo (montagem/uso), sem bloquear a troca.
    refetchType: "none",
    predicate: (q) =>
      isWorkspaceScopedQueryKey(q.queryKey) && !queryKeyCarriesScopeId(q.queryKey, scopeIds),
  });
}

