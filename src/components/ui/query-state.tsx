import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSlowLoading } from "@/hooks/use-slow-loading";

/**
 * Estado padrão de erro/loading-lento de dados de tela.
 *
 * Regra do sistema: todo loading termina em `success`, `empty` ou `error` —
 * nunca em skeleton indefinido. Quando a consulta demora além do razoável,
 * mostramos mensagem + retry em vez de manter o placeholder para sempre.
 */
export function DataErrorState({
  message,
  onRetry,
  compact = false,
}: {
  message?: string | null;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={
        compact
          ? "flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs"
          : "flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center text-sm"
      }
    >
      <span className="flex items-center gap-2 text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="text-foreground">
          {message?.slice(0, 200) || "Não foi possível carregar estes dados."}
        </span>
      </span>
      <Button size="sm" variant="outline" className="gap-2" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
      </Button>
    </div>
  );
}

/**
 * Aviso de consulta lenta com retry — renderizado ao lado do conteúdo
 * (nunca substituindo dados já visíveis).
 */
export function SlowLoadingNotice({
  active,
  onRetry,
  ms = 10_000,
}: {
  active: boolean;
  onRetry: () => void;
  ms?: number;
}) {
  const slow = useSlowLoading(active, ms);
  if (!slow) return null;
  return (
    <DataErrorState
      compact
      message="Isto está demorando mais do que o normal."
      onRetry={onRetry}
    />
  );
}
