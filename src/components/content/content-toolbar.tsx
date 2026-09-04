import { useMemo } from "react";
import {
  AlarmClock,
  CalendarClock,
  CalendarPlus,
  CheckSquare,
  FolderKanban,
  Filter,
  Image as ImageIcon,
  LayoutGrid,
  List,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CHANNELS } from "./stage-colors";
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABEL,
  normalizeContentFormat,
} from "@/lib/content-formats";

export type CreatedRange = "any" | "today" | "7d" | "30d";
export type ScheduledRange = "any" | "today" | "7d";
export type MediaFilter = "any" | "with" | "without";
export type SlaFilter = "any" | "on_track" | "at_risk" | "overdue";
export type ViewMode = "kanban" | "list";

export type ContentFilters = {
  createdRange: CreatedRange;
  scheduledRange: ScheduledRange;
  channel: string; // "any" | channel id
  format: string; // "any" | Feed/Reels/...
  media: MediaFilter;
  sla: SlaFilter;
  /** "any" | project_id | "none" (sem projeto) */
  project: string;
};

export const DEFAULT_CONTENT_FILTERS: ContentFilters = {
  createdRange: "any",
  scheduledRange: "any",
  channel: "any",
  format: "any",
  media: "any",
  sla: "any",
  project: "any",
};

export function isFiltersEmpty(f: ContentFilters) {
  return (
    f.createdRange === "any" &&
    f.scheduledRange === "any" &&
    f.channel === "any" &&
    f.format === "any" &&
    f.media === "any" &&
    f.sla === "any" &&
    f.project === "any"
  );
}

type Props = {
  filters: ContentFilters;
  onFiltersChange: (next: ContentFilters) => void;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  total: number;
  filtered: number;
  /** Projetos da workspace para o filtro por projeto. */
  projectOptions?: Array<{ id: string; name: string }>;
  /** Modo seleção em massa (Conteúdo). */
  selectionMode?: boolean;
  onToggleSelectionMode?: () => void;
};

export function ContentToolbar({
  filters,
  onFiltersChange,
  view,
  onViewChange,
  total,
  filtered,
  projectOptions,
  selectionMode,
  onToggleSelectionMode,
}: Props) {
  const activeCount = useMemo(() => {
    let n = 0;
    if (filters.createdRange !== "any") n++;
    if (filters.scheduledRange !== "any") n++;
    if (filters.channel !== "any") n++;
    if (filters.format !== "any") n++;
    if (filters.media !== "any") n++;
    if (filters.sla !== "any") n++;
    if (filters.project !== "any") n++;
    return n;
  }, [filters]);

  const set = <K extends keyof ContentFilters>(k: K, v: ContentFilters[K]) =>
    onFiltersChange({ ...filters, [k]: v });

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 p-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-xs">
            <Filter className="h-3.5 w-3.5" />
            Filtros
            {activeCount > 0 ? (
              <Badge variant="secondary" className="h-4 rounded-md px-1 text-[10px] tabular-nums">
                {activeCount}
              </Badge>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[320px] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold">Filtros</span>
            {!isFiltersEmpty(filters) ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => onFiltersChange(DEFAULT_CONTENT_FILTERS)}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Limpar
              </Button>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Select
              value={filters.createdRange}
              onValueChange={(v) => set("createdRange", v as CreatedRange)}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <CalendarPlus className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Data de criação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Criação: qualquer</SelectItem>
                <SelectItem value="today">Hoje</SelectItem>
                <SelectItem value="7d">Últimos 7 dias</SelectItem>
                <SelectItem value="30d">Últimos 30 dias</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.scheduledRange}
              onValueChange={(v) => set("scheduledRange", v as ScheduledRange)}
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Data de postagem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Postagem: qualquer</SelectItem>
                <SelectItem value="today">Agendados para hoje</SelectItem>
                <SelectItem value="7d">Próximos 7 dias</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.channel} onValueChange={(v) => set("channel", v)}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Rede social" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Todas as redes</SelectItem>
                {CHANNELS.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.format} onValueChange={(v) => set("format", v)}>
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue placeholder="Formato" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Todos formatos</SelectItem>
                {CONTENT_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {CONTENT_FORMAT_LABEL[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.project} onValueChange={(v) => set("project", v)}>
              <SelectTrigger className="h-8 w-full text-xs">
                <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Projeto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Todos os projetos</SelectItem>
                <SelectItem value="none">Sem projeto</SelectItem>
                {(projectOptions ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filters.media} onValueChange={(v) => set("media", v as MediaFilter)}>
              <SelectTrigger className="h-8 w-full text-xs">
                <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="Mídia" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Mídia: qualquer</SelectItem>
                <SelectItem value="with">Com imagem</SelectItem>
                <SelectItem value="without">Sem imagem</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.sla} onValueChange={(v) => set("sla", v as SlaFilter)}>
              <SelectTrigger className="h-8 w-full text-xs">
                <AlarmClock className="h-3.5 w-3.5 text-muted-foreground" />
                <SelectValue placeholder="SLA" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">SLA: qualquer</SelectItem>
                <SelectItem value="on_track">Em dia</SelectItem>
                <SelectItem value="at_risk">Próximo de vencer</SelectItem>
                <SelectItem value="overdue">Atrasadas</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>

      {onToggleSelectionMode ? (
        <Button
          size="sm"
          variant={selectionMode ? "default" : "outline"}
          className="h-8 gap-1.5 px-2.5 text-xs"
          onClick={onToggleSelectionMode}
        >
          <CheckSquare className="h-3.5 w-3.5" />
          {selectionMode ? "Sair da seleção" : "Selecionar"}
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-3">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {filtered}
          <span className="text-muted-foreground/60"> / {total}</span>
        </span>
        <ToggleGroup
          type="single"
          size="sm"
          value={view}
          onValueChange={(v) => v && onViewChange(v as ViewMode)}
          className="rounded-md border border-border/60 bg-background/60"
        >
          <ToggleGroupItem value="kanban" aria-label="Visão Kanban" className="h-8 px-2">
            <LayoutGrid className="h-4 w-4" />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="Visão em lista" className="h-8 px-2">
            <List className="h-4 w-4" />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </div>
  );
}

export function applyContentFilters<
  P extends {
    created_at: string;
    scheduled_at: string | null;
    channels: string[];
    format?: string | null;
    placements?: Array<{ format: string }> | null;
    cover_url: string | null;
    reference_media?: Array<{ path: string; type?: string }> | null;
    sla_status?: "none" | "on_track" | "at_risk" | "overdue";
    project_id?: string | null;
  },
>(posts: P[], f: ContentFilters): P[] {
  const now = Date.now();
  const DAY = 86_400_000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  return posts.filter((p) => {
    if (f.createdRange !== "any") {
      const created = new Date(p.created_at).getTime();
      if (f.createdRange === "today" && created < startOfToday.getTime()) return false;
      if (f.createdRange === "7d" && now - created > 7 * DAY) return false;
      if (f.createdRange === "30d" && now - created > 30 * DAY) return false;
    }
    if (f.scheduledRange !== "any") {
      if (!p.scheduled_at) return false;
      const sched = new Date(p.scheduled_at).getTime();
      if (f.scheduledRange === "today") {
        if (sched < startOfToday.getTime() || sched >= endOfToday.getTime()) return false;
      }
      if (f.scheduledRange === "7d") {
        if (sched < now || sched - now > 7 * DAY) return false;
      }
    }
    if (f.project !== "any") {
      const pid = p.project_id ?? null;
      if (f.project === "none" ? pid !== null : pid !== f.project) return false;
    }
    if (f.channel !== "any") {
      const ch = Array.isArray(p.channels) ? p.channels : [];
      if (!ch.includes(f.channel)) return false;
    }
    if (f.format !== "any") {
      // Comparação sempre em chave canônica — tolera registros legados.
      const target = normalizeContentFormat(f.format);
      const primary = normalizeContentFormat(p.format);
      const inPlacements = (p.placements ?? []).some(
        (pl) => normalizeContentFormat(pl.format) === target,
      );
      if (primary !== target && !inPlacements) return false;
    }
    if (f.media !== "any") {
      const hasCover =
        !!p.cover_url || (p.reference_media ?? []).some((m) => (m.type ?? "").startsWith("image"));
      if (f.media === "with" && !hasCover) return false;
      if (f.media === "without" && hasCover) return false;
    }
    if (f.sla !== "any") {
      if ((p.sla_status ?? "none") !== f.sla) return false;
    }
    return true;
  });
}
