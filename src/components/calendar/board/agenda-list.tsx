import { useMemo } from "react";
import { CalendarDays, Image as ImageIcon, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import type { PublicationItem } from "@/lib/calendar-board.functions";
import type { PendingSchedulePost } from "@/lib/scheduling-wizard.functions";
import { dayLabel, relativeLabel } from "@/lib/publication-status-tokens";
import { PublicationRow } from "./publication-card";
import { dayKey } from "./day-map";
import { formatDateBr } from "@/lib/timezone";

/** Visão Lista: itens agrupados por data, com faixa de status e pill à direita. */
export function AgendaList({
  items,
  drafts,
  loading,
  onOpen,
  onOpenDraft,
  onNew,
}: {
  items: PublicationItem[];
  drafts: PendingSchedulePost[];
  loading: boolean;
  onOpen: (i: PublicationItem) => void;
  onOpenDraft: (d: PendingSchedulePost) => void;
  onNew?: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, PublicationItem[]>();
    for (const it of items) {
      const k = it.when ? dayKey(new Date(it.when)) : "sem-data";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  return (
    <DashboardPanelSurface>
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando publicações…
        </div>
      ) : items.length === 0 && drafts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <PanelEmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            text="Nenhuma publicação neste período. Crie um conteúdo ou altere o período selecionado."
          />
          {onNew ? (
            <Button size="sm" onClick={onNew} className="mb-6">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Nova publicação
            </Button>
          ) : null}
        </div>
      ) : (
        <div>
          {drafts.length ? (
            <section>
              <header className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Rascunhos
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {drafts.length}
                </span>
              </header>
              <ul className="divide-y divide-border/60">
                {drafts.map((d) => (
                  <li key={d.postId}>
                    <button
                      type="button"
                      onClick={() => onOpenDraft(d)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                    >
                      {d.coverUrl ? (
                        <img
                          src={d.coverUrl}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded border border-border/60 object-cover"
                        />
                      ) : (
                        <span
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted/70 text-muted-foreground/50"
                          aria-hidden
                        >
                          <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.title}</span>
                        <span className="text-[11px] text-muted-foreground">
                          Atualizado {relativeLabel(d.approvedAt) || "—"}
                          {d.channels.length ? ` · ${d.channels.join(", ")}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Continuar edição
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {groups.map(([key, list]) => (
            <section key={key}>
              <header className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-4 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {key === "sem-data" ? "Sem data" : dayLabel(list[0]!.when)}
                  {key === "sem-data" ? null : (
                    <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground/80">
                      {formatDateBr(list[0]?.when)}
                    </span>
                  )}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {list.length}
                </span>
              </header>
              <ul className="divide-y divide-border/60">
                {list.map((it) => (
                  <li key={it.postId}>
                    <PublicationRow item={it} onOpen={onOpen} showDay={false} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </DashboardPanelSurface>
  );
}
