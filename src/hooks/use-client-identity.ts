import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listClients } from "@/lib/workspace.functions";
import { pickClientIdentity, type ClientIdentity } from "@/lib/client-identity";

/**
 * Identidade do cliente ativo (nome/nicho) sem custo de troca.
 *
 * Reaproveita a MESMA query do seletor (`["clients", brandId]`), portanto a
 * resposta é instantânea quando a lista já está em cache — e nunca devolve o
 * cliente anterior, porque a busca é por `clientId` exato.
 */
export function useClientIdentity(
  brandId: string | null,
  clientId: string | null,
): ClientIdentity | null {
  const list = useServerFn(listClients);
  const q = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => list({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 5 * 60_000,
  });
  return pickClientIdentity(q.data, clientId);
}
