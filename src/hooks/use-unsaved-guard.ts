import { useEffect } from "react";

/**
 * Avisa antes de sair da página quando há trabalho não salvo.
 *
 * Usado em formulários longos (briefing, entrevista de mídia paga, tarefas) para
 * que um recarregamento acidental — inclusive o do preview — não descarte o que
 * foi preenchido sem confirmação.
 */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
