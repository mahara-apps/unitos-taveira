import { createFileRoute } from "@tanstack/react-router";

import { usePageHeader } from "@/hooks/use-page-header";
import { LogViewer } from "@/components/system-logs/log-viewer";

export const Route = createFileRoute("/_authenticated/settings/logs")({
  component: LogsPage,
});

/**
 * Auditoria do Settings = atividade humana (ações de pessoas + notificações).
 * Execuções de IA (jobs) vivem no Centro de IA → /connections → IA → Execuções.
 */
function LogsPage() {
  usePageHeader({
    title: "Auditoria",
    subtitle: "Histórico de ações realizadas por pessoas na organização",
  });

  return (
    <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <LogViewer
        queryKey="settings-activity-logs"
        sources={["activity", "notification"]}
        title="Atividade humana"
        description="Ações de usuários e notificações emitidas. Últimas 300 entradas por consulta."
      />
    </div>
  );
}
