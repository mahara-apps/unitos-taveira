import { useEffect, useRef, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportLovableError } from "@/lib/lovable-error-reporting";

/**
 * Autorrecuperação: a primeira falha de uma tela é quase sempre transitória
 * (token renovando, rede oscilando, registro recém-criado ainda propagando).
 * Tentamos recarregar os dados UMA vez, sozinhos, e só então mostramos o aviso
 * com retry manual — nunca loop, nunca tela em branco.
 */
const recovered = new Set<string>();

/**
 * Fallback padrão para erros de rota. Renderizado no lugar do conteúdo da
 * rota, dentro do shell: a barra lateral e o topo continuam visíveis.
 */
export function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [autoRetrying, setAutoRetrying] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    console.error("[route-error]", error);
    reportLovableError(error, { boundary: "tanstack_default_error_component" });
  }, [error]);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (recovered.has(pathname)) return;
    recovered.add(pathname);
    setAutoRetrying(true);
    const t = setTimeout(() => {
      void router.invalidate();
      reset();
    }, 400);
    return () => clearTimeout(t);
  }, [pathname, reset, router]);

  if (autoRetrying) {
    return (
      <div
        aria-busy="true"
        aria-live="polite"
        className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-3 p-6"
      >
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Recarregando esta tela…</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[60vh] w-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border/60 bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
          Não foi possível carregar esta tela
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Seus dados estão salvos. Tente de novo — se continuar, recarregue a página.
        </p>
        <p className="mt-2 text-xs text-muted-foreground/80">
          {error?.message?.slice(0, 200) || ""}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button
            onClick={() => {
              recovered.delete(pathname);
              handled.current = false;
              void router.invalidate();
              reset();
            }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" /> Tentar de novo
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Recarregar página
          </Button>
        </div>
      </div>
    </div>
  );
}
