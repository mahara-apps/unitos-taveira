import { useEffect } from "react";
import type { QueryClient, Query } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  persistQueryClient,
  persistQueryClientSubscribe,
} from "@tanstack/react-query-persist-client";

/**
 * Persistência de snapshots das métricas sociais no localStorage.
 *
 * Motivação: as métricas vêm sempre da API do Meta (nunca do banco). O cache
 * do servidor é por isolate, então uma volta à tela de Analytics costumava
 * refazer todas as chamadas Graph e mostrar tela em branco/skeleton. Guardando
 * o último snapshot no navegador, a tela renderiza na hora e a atualização
 * acontece em background.
 *
 * Só as chaves de social analytics são persistidas — nada de auth/tokens.
 */

const STORAGE_KEY = "unitos:social-analytics-cache:v1";
export const SOCIAL_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

const PERSISTED_KEY_PREFIXES = ["social-analytics", "social-analytics-top"];

function shouldPersist(query: Query): boolean {
  const first = query.queryKey?.[0];
  if (typeof first !== "string") return false;
  if (!PERSISTED_KEY_PREFIXES.includes(first)) return false;
  return query.state.status === "success";
}

/**
 * Monta a persistência apenas no browser, após a hidratação. Restaura o
 * snapshot no cache do QueryClient e passa a salvar mudanças subsequentes.
 */
export function QueryPersistence({ queryClient }: { queryClient: QueryClient }) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: STORAGE_KEY,
      throttleTime: 1000,
    });

    void (async () => {
      try {
        await persistQueryClient({
          queryClient,
          persister,
          maxAge: SOCIAL_SNAPSHOT_MAX_AGE_MS,
          dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
        });
      } catch {
        // Snapshot corrompido/indisponível — segue sem cache persistente.
      }
      if (cancelled) return;
      unsubscribe = persistQueryClientSubscribe({
        queryClient,
        persister,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [queryClient]);

  return null;
}

/** Limpa o snapshot local (ex.: logout). */
export function clearSocialSnapshot() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
