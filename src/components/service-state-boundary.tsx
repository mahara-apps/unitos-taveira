import type { ReactNode } from "react";
import { AlertTriangle, Loader2, Lock } from "lucide-react";

import { useIsSuperAdmin } from "@/hooks/use-feature-access";
import { useServiceState } from "@/hooks/use-service-state";

/**
 * Faixa de atualização e tela de suspensão.
 *
 * - `maintenance`: leitura segue liberada, com faixa fixa no topo avisando
 *   para não salvar agora (a gravação fica desabilitada nas telas).
 * - `suspended`: ninguém navega, exceto Super Admin (que precisa entrar para
 *   resolver). Nenhum dado é apagado.
 */
export function ServiceStateBoundary({ children }: { children: ReactNode }) {
  const { gate } = useServiceState();
  const superQ = useIsSuperAdmin();
  const isSuper = !!superQ.data?.isSuperAdmin;

  if (gate.blocked && !isSuper) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
          <h1 className="text-lg font-semibold text-foreground">{gate.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{gate.message}</p>
          <p className="mt-4 text-xs text-muted-foreground">
            Nenhuma informação foi apagada. Fale com quem administra o sistema para liberar o
            acesso.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {gate.state !== "active" ? <ServiceStateBanner /> : null}
      {children}
    </>
  );
}

/** Faixa fixa no topo, exibida enquanto o ambiente não está normal. */
export function ServiceStateBanner() {
  const { gate } = useServiceState();
  if (gate.state === "active") return null;
  const maintenance = gate.state === "maintenance";
  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-3 py-2 text-center text-xs font-medium text-amber-900 dark:text-amber-100"
    >
      {maintenance ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      )}
      <span>{gate.message}</span>
    </div>
  );
}
