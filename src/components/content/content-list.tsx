import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Image as ImageIcon, UserCircle2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import {
  listBrandAssigneesFn,
  type Board,
  type BoardPost,
  type PipelineStage,
} from "@/lib/content.functions";
import { CHANNELS, CHANNEL_STYLES, FORMAT_STYLES } from "./stage-colors";
import {
  CONTENT_FORMAT_LABEL,
  normalizeContentFormat,
  type ContentFormat,
} from "@/lib/content-formats";
import { scheduleDisplay, scheduleFullLabel } from "@/lib/post-schedule-display";

const COLOR_DOT: Record<string, string> = {
  muted: "bg-muted-foreground/60",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
  cyan: "bg-sky-500",
};

type Props = {
  board: Board;
  posts: BoardPost[];
  onOpenPost: (id: string) => void;
  /** Modo seleção em massa (mudança de estágio em lote). */
  selectionMode?: boolean;
  selected?: string[];
  onToggleSelect?: (postId: string) => void;
  onSelectMany?: (ids: string[]) => void;
};

export function ContentList({
  board,
  posts,
  onOpenPost,
  selectionMode,
  selected = [],
  onToggleSelect,
  onSelectMany,
}: Props) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const allVisibleSelected =
    posts.length > 0 && posts.every((p) => selectedSet.has(p.id));
  const stageById = useMemo(() => {
    const m = new Map<string, PipelineStage>();
    for (const s of board.stages) m.set(s.id, s);
    return m;
  }, [board.stages]);

  const fetchMembers = useServerFn(listBrandAssigneesFn);
  const { data: members } = useQuery({
    queryKey: ["brand-assignees", board.pipeline.brand_id],
    queryFn: () => fetchMembers({ data: { brandId: board.pipeline.brand_id } }),
    staleTime: 60_000,
  });

  if (posts.length === 0) {
    return (
      <DashboardPanelSurface className="flex min-h-0 flex-1 items-center justify-center p-10">
        <PanelEmptyState
          icon={<ImageIcon className="h-5 w-5" />}
          text="Nenhum conteúdo com os filtros atuais."
        />
      </DashboardPanelSurface>
    );
  }

  return (
    <DashboardPanelSurface className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <TableRow>
              {selectionMode ? (
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={allVisibleSelected}
                    aria-label="Selecionar todos os visíveis"
                    onCheckedChange={() => {
                      const ids = posts.map((p) => p.id);
                      // Preserva itens selecionados fora do filtro atual.
                      onSelectMany?.(
                        allVisibleSelected
                          ? selected.filter((id) => !ids.includes(id))
                          : Array.from(new Set([...selected, ...ids])),
                      );
                    }}
                  />
                </TableHead>
              ) : null}
              <TableHead className="w-[76px]">Mídia</TableHead>
              <TableHead>Título</TableHead>
              <TableHead className="w-[160px]">Estágio</TableHead>
              <TableHead className="w-[200px]">Rede social</TableHead>
              <TableHead className="w-[130px]">Formato</TableHead>
              <TableHead className="w-[160px]">Postagem</TableHead>
              <TableHead className="w-[160px]">Autor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.map((p) => {
              const stage = p.stage_id ? stageById.get(p.stage_id) : null;
              const channelDefs = (p.channels ?? [])
                .map((id) => CHANNELS.find((c) => c.id === id))
                .filter(Boolean) as typeof CHANNELS;
              const formatKeys: ContentFormat[] = (() => {
                const seen = new Set<ContentFormat>();
                const out: ContentFormat[] = [];
                const push = (k: ContentFormat | null) => {
                  if (k && !seen.has(k)) {
                    seen.add(k);
                    out.push(k);
                  }
                };
                push(normalizeContentFormat(p.format));
                for (const pl of p.placements ?? []) push(normalizeContentFormat(pl.format));
                return out.slice(0, 2);
              })();
              const schedule = scheduleDisplay(p);
              const member = members?.find((m) => m.id === p.assignee_id);
              return (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => (selectionMode ? onToggleSelect?.(p.id) : onOpenPost(p.id))}
                >
                  {selectionMode ? (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedSet.has(p.id)}
                        aria-label="Selecionar conteúdo"
                        onCheckedChange={() => onToggleSelect?.(p.id)}
                      />
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {p.cover_url ? (
                      <img
                        src={p.cover_url}
                        alt=""
                        className="h-12 w-12 rounded-md border border-border/60 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border/60 bg-muted/40 text-muted-foreground/60">
                        <ImageIcon className="h-4 w-4" />
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="line-clamp-1 text-sm font-medium text-foreground">
                      {p.title || "Sem título"}
                    </div>
                    {p.copy ? (
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {p.copy.replace(/\s+/g, " ").trim()}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {stage ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-0.5 text-xs">
                        <span
                          className={`h-2 w-2 rounded-full ${COLOR_DOT[stage.color] ?? COLOR_DOT.muted}`}
                        />
                        {stage.label}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {channelDefs.length === 0 ? (
                        <span
                          className="inline-flex items-center rounded-full border border-dashed border-amber-500/50 bg-amber-500/5 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400"
                          title="Sem canal a peça não entra no calendário nem pode publicar."
                        >
                          Definir canal
                        </span>
                      ) : (
                        channelDefs.slice(0, 3).map((c) => {
                          const Icon = c.icon;
                          return (
                            <span
                              key={c.id}
                              className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider ${CHANNEL_STYLES[c.id] ?? "border-border/60 bg-muted/40"}`}
                            >
                              <Icon className="h-2.5 w-2.5" />
                              {c.label}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {formatKeys.length === 0 ? (
                        <span
                          className="inline-flex items-center rounded-full border border-dashed border-amber-500/50 bg-amber-500/5 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400"
                          title="Sem formato a peça não entra no calendário nem pode publicar."
                        >
                          Definir formato
                        </span>
                      ) : (
                        formatKeys.map((f) => (
                          <span
                            key={f}
                            className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider ${FORMAT_STYLES[f]}`}
                          >
                            {CONTENT_FORMAT_LABEL[f]}
                          </span>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span
                        className="inline-flex items-center gap-1 text-xs tabular-nums text-foreground/80"
                        title={
                          schedule.iso ? scheduleFullLabel(schedule.iso) : "Sem data definida"
                        }
                      >
                        <CalendarDays className="h-3 w-3" />
                        {schedule.iso ? schedule.label : "—"}
                      </span>
                      <span
                        className={`inline-flex w-fit items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider ${schedule.chip}`}
                      >
                        {schedule.stateLabel}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {member ? (
                      <span className="inline-flex items-center gap-1.5">
                        {member.avatar_url ? (
                          <img
                            src={member.avatar_url}
                            alt=""
                            className="h-5 w-5 rounded-full object-cover"
                          />
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
                            {(member.name ?? "?")
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((s) => s[0]?.toUpperCase())
                              .join("")}
                          </span>
                        )}
                        <span className="truncate text-xs text-foreground/80">{member.name}</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <UserCircle2 className="h-3.5 w-3.5" /> Sem responsável
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </DashboardPanelSurface>
  );
}
