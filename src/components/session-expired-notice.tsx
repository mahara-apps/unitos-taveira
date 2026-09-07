import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Aviso de sessão expirada.
 *
 * Substitui o redirecionamento imediato para /login: a página (e tudo que
 * estiver em edição) permanece intacta; o usuário decide quando entrar
 * novamente. Disparado por `nx:session-expired` (ver src/start.ts).
 */
export function SessionExpiredNotice() {
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    const onExpired = (e: Event) => {
      const detail = (e as CustomEvent<{ next?: string }>).detail;
      setNext(detail?.next ?? "/dashboard");
    };
    window.addEventListener("nx:session-expired", onExpired);
    return () => window.removeEventListener("nx:session-expired", onExpired);
  }, []);

  if (!next) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Sua sessão expirou</p>
          <p className="text-xs text-muted-foreground">
            Entre novamente para continuar. O que está nesta tela não foi perdido.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={() => setNext(null)}>
            Depois
          </Button>
          <Button
            size="sm"
            onClick={() => {
              window.location.assign(`/login?next=${encodeURIComponent(next)}`);
            }}
          >
            Entrar novamente
          </Button>
        </div>
      </div>
    </div>
  );
}
