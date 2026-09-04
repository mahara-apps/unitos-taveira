import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportLovableError } from "@/lib/lovable-error-reporting";

/**
 * Fallback padrão para erros de rota. Mantém a sidebar viva e permite retry.
 */
export function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    console.error("[route-error]", error);
    reportLovableError(error, { boundary: "tanstack_default_error_component" });
  }, [error]);

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border/60 bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
          Erro ao carregar a página
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message?.slice(0, 240) || "Algo deu errado ao carregar este conteúdo."}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" /> Tentar novamente
          </Button>
        </div>
      </div>
    </div>
  );
}
