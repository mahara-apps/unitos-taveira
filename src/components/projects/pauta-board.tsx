/**
 * Board de pautas do job de conteúdo — kanban pelos seis estágios do ciclo,
 * com visões Board / Lista / Matriz e filtros por rede e unidade.
 * Apenas apresentação: os itens já vêm normalizados pela tela do projeto.
 */
import { useMemo, useState } from "react";
import { Image as ImageIcon, Kanban, LayoutGrid, List as ListIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { CONTENT_STAGE, CONTENT_STAGES, unitChipClass } from "@/lib/content-stage-tokens";
import type { ContentStage } from "@/lib/content-stage-tokens";
import { cn } from "@/lib/utils";
import { StageLegend } from "./stage-funnel";

export type BoardPauta = {
  key: string;
  title: string;
  stage: ContentStage;
  channelLabel: string | null;
  formatLabel: string | null;
  unitLabel: string | null;
  assigneeName: string | null;
  coverUrl: string | null;
  dateLabel: string | null;
  outOfPlan?: boolean;
};

const BOARD_VIEWS = ["board", "list", "matrix"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

const VIEW_META: Record<BoardView, { label: string; icon: typeof Kanban }> = {
  board: { label: "Board", icon: Kanban },
  list: { label: "Lista", icon: ListIcon },
  matrix: { label: "Matriz", icon: LayoutGrid },
};

function Thumb({ url, className }: { url: string | null; className?: string }) {
  return (
    <div className={cn("shrink-0 overflow-hidden rounded-md bg-muted/70", className)}>
      {url ? (
        <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
        </div>
      )}
    </div>
  );
}

function PautaCard({ item, onOpen }: { item: BoardPauta; onOpen: () => void }) {
  const token = CONTENT_STAGE[item.stage];
  return (
    <button
      type="button"
      onClick={onOpen}
      title={item.title}
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border border-l-2 border-border/60 bg-card px-3 py-2.5 text-left transition-colors",
        "hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        token.accent,
      )}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        {item.unitLabel ? (
          <Badge
            variant="outline"
            className={cn("h-5 rounded-full px-2 text-[10px]", unitChipClass(item.unitLabel))}
          >
            {item.unitLabel}
          </Badge>
        ) : null}
        {item.channelLabel ? (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {item.channelLabel}
          </span>
        ) : null}
        {item.formatLabel ? (
          <span className="text-[10px] text-muted-foreground">· {item.formatLabel}</span>
        ) : null}
      </span>

      <span className="flex min-w-0 items-start gap-2">
        <Thumb url={item.coverUrl} className="h-9 w-9" />
        <span className="line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug">
          {item.title}
        </span>
      </span>

      <span className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{item.assigneeName ?? "Sem responsável"}</span>
        {item.dateLabel ? <span className="tabular-nums">{item.dateLabel}</span> : null}
      </span>
    </button>
  );
}

export function PautaBoard({
  items,
  onOpenItem,
  view,
  onViewChange,
  stage = null,
  onStageChange,
}: {
  items: BoardPauta[];
  onOpenItem: (key: string) => void;
  view: BoardView;
  onViewChange: (v: BoardView) => void;
  stage?: ContentStage | null;
  onStageChange?: (s: ContentStage | null) => void;
}) {
  const [channel, setChannel] = useState("all");
  const [unit, setUnit] = useState("all");

  const channels = useMemo(
    () => Array.from(new Set(items.map((i) => i.channelLabel).filter(Boolean) as string[])).sort(),
    [items],
  );
  const units = useMemo(
    () => Array.from(new Set(items.map((i) => i.unitLabel).filter(Boolean) as string[])).sort(),
    [items],
  );

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          (channel === "all" || i.channelLabel === channel) &&
          (unit === "all" || i.unitLabel === unit) &&
          (!stage || i.stage === stage),
      ),
    [items, channel, unit, stage],
  );

  const byStage = useMemo(() => {
    const map = new Map<ContentStage, BoardPauta[]>();
    for (const s of CONTENT_STAGES) map.set(s, []);
    for (const i of filtered) map.get(i.stage)!.push(i);
    return map;
  }, [filtered]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {units.length > 0 ? (
          <Select value={unit} onValueChange={setUnit}>
            <SelectTrigger className="h-9 w-[170px] text-xs">
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as unidades</SelectItem>
              {units.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger className="h-9 w-[160px] text-xs">
            <SelectValue placeholder="Rede" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as redes</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto inline-flex h-9 items-center rounded-md border border-border/60 bg-muted/40 p-0.5">
          {BOARD_VIEWS.map((v) => {
            const Icon = VIEW_META[v].icon;
            return (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={view === v ? "secondary" : "ghost"}
                aria-pressed={view === v}
                onClick={() => onViewChange(v)}
                className="h-8 gap-1.5 px-2.5 text-xs"
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{VIEW_META[v].label}</span>
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StageLegend />
        {stage ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onStageChange?.(null)}
          >
            Limpar estágio: {CONTENT_STAGE[stage].label}
          </Button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <PanelEmptyState
          icon={<Kanban className="h-4 w-4" />}
          text="Nenhum item de pauta para os filtros escolhidos."
        />
      ) : view === "board" ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {CONTENT_STAGES.map((s) => {
            const list = byStage.get(s) ?? [];
            const token = CONTENT_STAGE[s];
            return (
              <div key={s} className="min-w-0 rounded-lg border border-border/60 bg-muted/20 p-2">
                <div className="mb-2 flex items-center gap-1.5 px-1">
                  <span className={cn("h-1.5 w-1.5 rounded-full", token.dot)} />
                  <span className="truncate text-[11px] font-medium">{token.label}</span>
                  <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                    {list.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {list.length === 0 ? (
                    <p className="px-1 py-3 text-[11px] text-muted-foreground">Nada aqui.</p>
                  ) : (
                    list.map((i) => (
                      <PautaCard key={i.key} item={i} onOpen={() => onOpenItem(i.key)} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : view === "list" ? (
        <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {filtered.map((i) => {
            const token = CONTENT_STAGE[i.stage];
            return (
              <button
                key={i.key}
                type="button"
                onClick={() => onOpenItem(i.key)}
                className={cn(
                  "flex w-full items-center gap-3 border-l-2 px-4 py-3 text-left transition-colors hover:bg-muted/40",
                  token.accent,
                )}
              >
                <Thumb url={i.coverUrl} className="h-9 w-9" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{i.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[i.unitLabel, i.channelLabel, i.formatLabel, i.dateLabel, i.assigneeName]
                      .filter(Boolean)
                      .join(" · ") || "Sem metadados"}
                  </span>
                </span>
                <Badge
                  variant="outline"
                  className={cn("h-5 shrink-0 rounded-full px-2 text-[10px]", token.chip)}
                >
                  {token.label}
                </Badge>
              </button>
            );
          })}
        </div>
      ) : (
        <MatrixView items={filtered} />
      )}
    </div>
  );
}

/** Matriz Unidade × Rede — quando não há unidades cadastradas, agrupa em "Geral". */
function MatrixView({ items }: { items: BoardPauta[] }) {
  const rows = useMemo(
    () => Array.from(new Set(items.map((i) => i.unitLabel ?? "Geral"))).sort(),
    [items],
  );
  const cols = useMemo(
    () => Array.from(new Set(items.map((i) => i.channelLabel ?? "Sem rede"))).sort(),
    [items],
  );
  const count = (r: string, c: string) =>
    items.filter((i) => (i.unitLabel ?? "Geral") === r && (i.channelLabel ?? "Sem rede") === c)
      .length;

  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/30">
            <th className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Unidade
            </th>
            {cols.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.map((r) => (
            <tr key={r}>
              <td className="px-3 py-2">
                <Badge
                  variant="outline"
                  className={cn("h-5 rounded-full px-2 text-[10px]", unitChipClass(r))}
                >
                  {r}
                </Badge>
              </td>
              {cols.map((c) => (
                <td key={c} className="px-3 py-2 tabular-nums text-muted-foreground">
                  {count(r, c) || "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
