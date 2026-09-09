import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Indicador de carregamento central e reaproveitável.
 *
 * Regra do sistema: nenhuma tela interna pode ficar em branco. Onde antes
 * renderizávamos `null` (ex.: gate de sessão do `_authenticated`), agora
 * pintamos este indicador — e, se passar do razoável, oferecemos recarregar
 * em vez de deixar o usuário achar que o sistema quebrou.
 */
export function AppLoading({
  label = "Carregando…",
  slowMs = 8000,
  fullscreen = false,
}: {
  label?: string;
  slowMs?: number;
  fullscreen?: boolean;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), slowMs);
    return () => clearTimeout(t);
  }, [slowMs]);

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={
        fullscreen
          ? "flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background p-6"
          : "flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-3 p-6"
      }
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{label}</p>
      {slow ? (
        <div className="mt-2 flex flex-col items-center gap-2 text-center">
          <p className="max-w-xs text-xs text-muted-foreground">
            Está demorando mais que o normal. Você pode aguardar ou recarregar.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Recarregar
          </Button>
        </div>
      ) : null}
    </div>
  );
}
