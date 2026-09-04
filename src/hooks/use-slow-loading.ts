import { useEffect, useState } from "react";

/**
 * Detecta loading anormalmente longo — usado como fallback de UX para nunca
 * deixar uma tela presa em skeleton sem explicação nem saída (retry).
 * Não substitui a correção da query lenta: só garante estado final visível.
 */
export function useSlowLoading(active: boolean, ms = 10_000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}
