import { redirect } from "@tanstack/react-router";
import { getCachedFeatureAccess, type FeatureAccessResult } from "./access-cache";
import {
  getActiveWorkspace,
  getPersistedWorkspaceHint,
  waitForActiveWorkspace,
} from "./active-workspace";

export type { FeatureAccessResult };

/**
 * Bloqueia a navegação para um módulo quando a feature não está habilitada.
 * Uso em `beforeLoad` de rotas — roda client-side (subtree é `ssr: false`).
 *
 * O workspace vem do contexto canônico (`active-workspace`, alimentado pelo
 * `ActiveContextProvider`), não de `localStorage`. Enquanto o contexto não
 * resolve, aguardamos: ausência de workspace NÃO é ausência de plano.
 */
export async function ensureFeatureEnabled(featureKey: string): Promise<void> {
  // Quando o workspace já é conhecido, a consulta de entitlement começa em
  // paralelo com a espera pela resolução do contexto (antes eram seriais). O
  // resultado só é aproveitado se o workspace resolvido for o mesmo — nenhuma
  // autorização é assumida por antecipação.
  const live = getActiveWorkspace();
  // Carregamento direto da rota (F5 / link): o provider ainda não montou, então
  // o registro canônico está "não resolvido". Nesse caso a preferência
  // persistida é usada como dica para consultar o entitlement do workspace
  // provável, em vez de esperar o timeout e concluir "sem workspace".
  const hint = live.resolved ? null : getPersistedWorkspaceHint();
  const optimisticBrandId = live.brandId ?? hint;
  const optimistic = optimisticBrandId
    ? getCachedFeatureAccess(optimisticBrandId, featureKey)
    : null;
  const waited = await waitForActiveWorkspace(optimisticBrandId ? 1_200 : 3_000);
  const brandId = waited.resolved ? waited.brandId : optimisticBrandId;
  const result =
    optimistic && brandId && brandId === optimisticBrandId
      ? await optimistic
      : await getCachedFeatureAccess(brandId, featureKey);
  if (result.enabled) return;
  // Contexto ainda não resolveu: inicialização não é bloqueio de plano.
  if (!waited.resolved && !brandId) return;
  // Falha ao resolver o workspace também não é bloqueio de plano.
  if (waited.status === "error") return;

  // Falha de consulta não é bloqueio de plano: o servidor (RLS/guards) segue
  // sendo a autoridade de cada leitura/escrita dentro da tela.
  if (result.reason === "entitlement_error") return;
  throw redirect({
    to: "/dashboard",
    search: { blocked: featureKey, reason: result.reason },
  });
}
