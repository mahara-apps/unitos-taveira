import { createFileRoute } from "@tanstack/react-router";

import { usePageHeader } from "@/hooks/use-page-header";
import { AccessLogView } from "@/components/settings/access-log/access-log-view";

export const Route = createFileRoute("/_authenticated/settings/access-log")({
  component: AccessLogPage,
});

/**
 * Acessos = quem entrou no sistema e com que frequência.
 * Ações realizadas dentro do sistema ficam em Configurações → Auditoria.
 */
function AccessLogPage() {
  usePageHeader({
    title: "Acessos",
    subtitle: "Histórico de entradas da equipe e dos clientes do portal",
  });

  return <AccessLogView />;
}
