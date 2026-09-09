import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getServiceStateFn } from "@/lib/service-state.functions";
import { ACTIVE_SERVICE_STATE, resolveServiceGate, type ServiceGate } from "@/lib/service-state";

/**
 * Estado operacional da instalação (faixa de atualização / suspensão).
 *
 * Leitura pública e barata, revalidada com frequência: durante uma
 * atualização o MASTER liga e desliga o estado no meio da navegação.
 */
export function useServiceState(): { gate: ServiceGate; isReady: boolean } {
  const read = useServerFn(getServiceStateFn);
  const q = useQuery({
    queryKey: ["installation-service-state"],
    queryFn: () => read(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  return {
    gate: resolveServiceGate(q.data ?? ACTIVE_SERVICE_STATE),
    isReady: !q.isLoading,
  };
}

/** Atalho para desabilitar botões de criar/salvar durante uma atualização. */
export function useWritesBlocked(): boolean {
  return useServiceState().gate.writesBlocked;
}
