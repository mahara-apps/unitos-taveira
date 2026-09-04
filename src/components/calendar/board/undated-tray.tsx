/**
 * Faixa "Sem data" do calendário.
 *
 * Mostra as peças que ainda não têm dia/hora e permite datá-las sem sair da
 * visão de calendário: seleciona uma peça aqui e clica num dia da grade.
 * Também oferece a sugestão em massa de dia/hora (persona + histórico real).
 */
import { CalendarPlus, Loader2, MousePointerClick, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatLabel } from "@/lib/publication-status-tokens";
import type { UndatedPost } from "@/lib/schedule-suggest.server";

export function UndatedTray({
  items,
  loading,
  selectedId,
  onSelect,
  onSuggest,
  suggesting,
  canSuggest,
}: {
  items: UndatedPost[];
  loading?: boolean;
  selectedId: string | null;
  onSelect: (postId: string | null) => void;
  onSuggest?: () => void;
  suggesting?: boolean;
  canSuggest?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando peças sem data…
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-border/60 bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-2 text-[12px]">
          <CalendarPlus className="h-4 w-4 text-muted-foreground" />
          <span className="font-semibold">Sem data ainda ({items.length})</span>
          <span className="text-[11px] text-muted-foreground">
            {selectedId ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <MousePointerClick className="h-3 w-3" />
                Clique num dia do calendário para propor a data
              </span>
            ) : (
              "Selecione uma peça para posicioná-la no calendário"
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {selectedId ? (
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={() => onSelect(null)}>
              <X className="h-3 w-3" />
              Cancelar seleção
            </Button>
          ) : null}
          {onSuggest ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-[11px]"
              disabled={suggesting || !canSuggest}
              title={canSuggest ? undefined : "Selecione um cliente para sugerir datas"}
              onClick={onSuggest}
            >
              {suggesting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Sugerir datas com IA
            </Button>
          ) : null}
        </div>
      </header>

      <ul className="flex gap-2 overflow-x-auto px-3 py-2">
        {items.map((item) => {
          const active = selectedId === item.postId;
          return (
            <li key={item.postId} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(active ? null : item.postId)}
                aria-pressed={active}
                className={cn(
                  "w-[200px] rounded-lg border px-2.5 py-2 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border/60 bg-background hover:bg-muted/60",
                )}
              >
                <span className="block truncate text-[12px] font-medium">{item.title}</span>
                <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                  {[item.formats[0] ? formatLabel(item.formats[0]) : null, ...item.channels]
                    .filter(Boolean)
                    .join(" · ") || "Sem canal definido"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
