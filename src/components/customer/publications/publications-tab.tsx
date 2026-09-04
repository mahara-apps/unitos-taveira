/**
 * Aba "Publicações" do Painel do Cliente.
 *
 * Reúso puro do que já existe na Central de Publicação (/calendario):
 *  - dados        → `listPublicationBoardFn`
 *  - itens        → `PublicationRow`
 *  - detalhe/ações→ `PublicationDetailModal` (retry/cancelar já existentes)
 *  - destinos     → `ChannelsTab` (vínculo de contas sociais do cliente)
 *
 * A edição/agendamento continua a acontecer no /calendario (ScheduleWizard),
 * que depende do contexto ativo completo — não é duplicado aqui.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CheckCircle2, ExternalLink, Megaphone, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { Skeleton } from "@/components/ui/skeleton";
import { listPublicationBoardFn, type PublicationItem } from "@/lib/calendar-board.functions";
import { PublicationRow } from "@/components/calendar/board/publication-card";
import { PublicationDetailModal } from "@/components/calendar/board/publication-detail";
import { ChannelsTab } from "@/components/customer/channels-tab";
import { PanelError, PanelSection } from "@/components/customer/ui/panel-section";

const DAY = 86_400_000;

export function PublicationsTab({ brandId, clientId }: { brandId: string; clientId: string }) {
  const qc = useQueryClient();
  const loadBoard = useServerFn(listPublicationBoardFn);
  const [detail, setDetail] = useState<PublicationItem | null>(null);

  // Janela fixa: 30 dias para trás (histórico recente) + 60 dias à frente.
  const { from, to } = useMemo(() => {
    const now = Date.now();
    return {
      from: new Date(now - 30 * DAY).toISOString(),
      to: new Date(now + 60 * DAY).toISOString(),
    };
  }, []);

  const boardKey = ["publication-board", brandId, clientId, from, to] as const;
  const boardQ = useQuery({
    queryKey: boardKey,
    queryFn: () => loadBoard({ data: { brandId, clientId, from, to } }),
    staleTime: 30_000,
  });

  const items = useMemo(() => boardQ.data?.items ?? [], [boardQ.data]);
  const awaiting = useMemo(() => boardQ.data?.awaitingApproval ?? [], [boardQ.data]);

  const counters = useMemo(() => {
    const nowIso = new Date().toISOString();
    return {
      scheduled: items.filter((i) => i.overall === "scheduled" && (i.when ?? "") >= nowIso).length,
      published: items.filter((i) => i.overall === "published").length,
      problems: items.filter((i) => i.overall === "failed" || i.overall === "partial").length,
      awaiting: awaiting.length,
    };
  }, [items, awaiting]);

  const ordered = useMemo(
    () =>
      [...items].sort((a, b) =>
        (b.when ?? b.createdAt ?? "").localeCompare(a.when ?? a.createdAt ?? ""),
      ),
    [items],
  );

  return (
    <div className="space-y-6">
      <PageKpiGrid columns={4}>
        <PageKpi
          icon={<CalendarClock />}
          label="Agendadas"
          value={boardQ.isPending ? "—" : counters.scheduled}
          status="info"
          description="Com data marcada"
        />
        <PageKpi
          icon={<CheckCircle2 />}
          label="Publicadas"
          value={boardQ.isPending ? "—" : counters.published}
          status="success"
          description="Nos últimos 30 dias"
        />
        <PageKpi
          icon={<TriangleAlert />}
          label="Com falha"
          value={boardQ.isPending ? "—" : counters.problems}
          status={counters.problems > 0 ? "danger" : "neutral"}
          description="Precisam de nova tentativa"
        />
        <PageKpi
          icon={<Megaphone />}
          label="Aguardando aprovação"
          value={boardQ.isPending ? "—" : counters.awaiting}
          status={counters.awaiting > 0 ? "warning" : "neutral"}
          description="Esperando resposta do cliente"
        />
      </PageKpiGrid>

      <PanelSection
        padded={false}
        icon={<Megaphone />}
        title="Próximas publicações e histórico"
        description="Últimos 30 dias e próximos 60 dias, em ordem de data."
        action={
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
            <Link to="/calendar">
              Abrir calendário
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      >
        {boardQ.isError ? (
          <PanelError
            message="Não foi possível carregar as publicações deste cliente."
            onRetry={() => boardQ.refetch()}
          />
        ) : boardQ.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : ordered.length === 0 ? (
          <PanelEmptyState
            icon={<Megaphone className="h-4 w-4" />}
            text="Nenhuma publicação neste período. Agende uma pelo calendário para começar."
          />
        ) : (
          <div className="divide-y divide-border/60">
            {ordered.map((item) => (
              <PublicationRow key={item.postId} item={item} onOpen={setDetail} />
            ))}
          </div>
        )}
      </PanelSection>

      {/* Destinos de publicação (contas sociais vinculadas a este cliente). */}
      <ChannelsTab brandId={brandId} clientId={clientId} />

      <PublicationDetailModal
        item={detail}
        open={!!detail}
        onOpenChange={(v) => !v && setDetail(null)}
        // Edição/reagendamento continua sendo feita na Central de Publicação.
        onEdit={() => setDetail(null)}
        onChanged={() => qc.invalidateQueries({ queryKey: boardKey })}
      />
    </div>
  );
}
