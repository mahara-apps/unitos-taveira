import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authUserQueryOptions } from "@/lib/auth-cache";

/** Watchdog: a resolução da identidade não pode prender a tela. */
const SESSION_READY_TIMEOUT_MS = 8_000;

export type SessionUser = {
  /** Id do usuário da sessão (null quando ainda não resolveu ou falhou). */
  userId: string | null;
  /**
   * `true` quando a identidade já terminou de resolver — ou quando o watchdog
   * estourou. Queries de tela usam isso em `enabled`: sem o watchdog, uma
   * resolução travada deixava a query desabilitada para sempre e a tela em
   * skeleton eterno. Liberando o gate, a chamada acontece e falha de forma
   * terminal (401), que a tela sabe desenhar com retry.
   */
  ready: boolean;
};

/**
 * Identidade da sessão atual — usada para isolar chaves de cache por usuário
 * (nenhuma tela pode reaproveitar dados de outra identidade) e para saber
 * quando é seguro disparar as queries da tela.
 */
export function useSessionUser(): SessionUser {
  const q = useQuery({ ...authUserQueryOptions(), retry: 0 });
  const settled = q.isSuccess || q.isError;
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (settled) return;
    const t = setTimeout(() => setExpired(true), SESSION_READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [settled]);

  return { userId: q.data?.id ?? null, ready: settled || expired };
}

/** Compat: apenas o id da sessão (chave de cache). */
export function useSessionUserId(): string | null {
  return useSessionUser().userId;
}
