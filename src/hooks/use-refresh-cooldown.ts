import { useCallback, useEffect, useState } from "react";

const PREFIX = "refresh-cooldown:";

function readLast(key: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(PREFIX + key);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Trava de tempo para atualizações manuais (rate limit de segurança).
 * O último disparo é persistido em localStorage, então o cooldown
 * sobrevive a recarregamentos e trocas de tela.
 */
export function useRefreshCooldown(key: string, cooldownMs = 60_000) {
  const [remaining, setRemaining] = useState(0);

  const tick = useCallback(() => {
    const left = Math.max(0, readLast(key) + cooldownMs - Date.now());
    setRemaining(left);
    return left;
  }, [key, cooldownMs]);

  useEffect(() => {
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [tick]);

  const start = useCallback(() => {
    window.localStorage.setItem(PREFIX + key, String(Date.now()));
    tick();
  }, [key, tick]);

  return {
    /** ms restantes até liberar o botão */
    remaining,
    /** segundos restantes (arredondado para cima) */
    remainingSeconds: Math.ceil(remaining / 1000),
    blocked: remaining > 0,
    start,
  };
}
