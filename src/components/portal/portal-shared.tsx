import { AlertTriangle, Home, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/* --------------------------------- UI base -------------------------------- */

export function FullScreenLoader() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background"
      role="status"
      aria-label="Carregando"
    >
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function PortalAccessError({
  message,
  mode,
  onRetry,
}: {
  message?: string;
  mode: "token" | "session";
  onRetry?: () => void;
}) {
  const tokenMessage = message?.includes("token_expired")
    ? "Este acesso expirou. Peça um novo link à equipe."
    : message?.includes("token_revoked")
      ? "Este acesso foi encerrado pela equipe."
      : message?.includes("portal_rate_limited")
        ? "Houve muitas tentativas. Aguarde alguns minutos e tente novamente."
        : "Este acesso não está disponível. Peça um novo link à equipe.";
  const sessionMessage = message?.includes("portal_service_key_missing")
    ? "Esta área depende de uma integração ainda não configurada pela equipe. Avise o responsável."
    : message?.includes("portal_client_context_invalid")
      ? "A marca indicada no endereço não pertence ao seu acesso. Volte à sua área e escolha uma marca válida."
      : message?.includes("portal_client_context_required")
        ? "Não identificamos qual marca abrir. Volte à sua área e selecione a marca."
        : message?.includes("portal_client_context_mismatch")
          ? "Houve um conflito de contexto de marca. Recarregue e selecione a marca novamente."
          : message?.includes("portal_no_client_access")
            ? "Sua conta ainda não está vinculada a nenhuma marca. Fale com a equipe responsável."
            : message?.includes("client_not_allowed")
              ? "Você não tem acesso a esta marca."
              : "Não foi possível abrir sua área do cliente. Tente novamente ou entre novamente na sua conta.";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-7 w-7 text-severity-warning" />
        <h1 className="mt-4 text-lg font-semibold">Acesso indisponível</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "token" ? tokenMessage : sessionMessage}
        </p>

        {onRetry ? (
          <Button size="sm" className="mt-5 gap-2" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" /> Tentar novamente
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Home;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-card px-6 py-16 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" />
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </div>
  );
}

/**
 * FASE 8 — estado de erro único do Portal.
 *
 * Antes, uma consulta que falhava caía no empty state ("Você está em dia"), o
 * que dava ao cliente a informação errada. Agora todo bloco de dados mostra
 * este aviso com a opção de tentar novamente.
 */
export function ErrorState({
  description = "Não conseguimos carregar estas informações agora.",
  onRetry,
}: {
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-card px-6 py-14 text-center"
    >
      <AlertTriangle className="h-6 w-6 text-severity-warning" />
      <div className="text-sm font-medium">Algo deu errado</div>
      <div className="text-xs text-muted-foreground">{description}</div>
      {onRetry ? (
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

export function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="aspect-[4/5] w-full" />
      ))}
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/* -------------------------------- formatters ------------------------------ */

export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
export function formatMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}
export function shiftYm(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function buildMonthGrid(ym: string): Array<Date | null> {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const cells: Array<Date | null> = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(y, m - 1, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
export function formatBytes(n: number | null) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
