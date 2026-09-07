import { useEffect, useRef, type ReactNode } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutList,
  LayoutDashboard,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CalendarView = "calendar" | "list" | "board";
export type CalendarRange = "week" | "month";

const VIEWS: Array<{ key: CalendarView; label: string; Icon: typeof CalendarDays }> = [
  { key: "calendar", label: "Calendário", Icon: CalendarDays },
  { key: "list", label: "Lista", Icon: LayoutList },
  { key: "board", label: "Painel", Icon: LayoutDashboard },
];

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ key: T; label: string; Icon?: typeof CalendarDays }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-md border border-border/60 bg-background p-0.5"
    >
      {options.map(({ key, label, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Barra superior do Calendário: busca (Cmd/Ctrl+K), seletor de visão,
 * Semana/Mês (só na visão Calendário), navegação de data e ação "Novo".
 */
export function CalendarToolbar({
  view,
  onView,
  range,
  onRange,
  query,
  onQuery,
  onPrev,
  onToday,
  onNext,
  newAction,
}: {
  view: CalendarView;
  onView: (v: CalendarView) => void;
  range: CalendarRange;
  onRange: (v: CalendarRange) => void;
  query: string;
  onQuery: (v: string) => void;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  newAction?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card px-2 py-2">
      <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Buscar publicação…"
          aria-label="Buscar publicação"
          className="h-9 w-full rounded-md border border-border/60 bg-background pl-8 pr-16 text-xs outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border/60 bg-muted px-1 py-px text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        )}
      </div>

      <Segmented options={VIEWS} value={view} onChange={onView} ariaLabel="Visão do calendário" />

      {view === "calendar" ? (
        <Segmented
          options={[
            { key: "week" as CalendarRange, label: "Semana" },
            { key: "month" as CalendarRange, label: "Mês" },
          ]}
          value={range}
          onChange={onRange}
          ariaLabel="Período"
        />
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <div className="flex items-center rounded-md border border-border/60">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-r-none"
            aria-label="Período anterior"
            onClick={onPrev}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 rounded-none border-x border-border/60"
            onClick={onToday}
          >
            Hoje
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-l-none"
            aria-label="Próximo período"
            onClick={onNext}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {newAction}
      </div>
    </div>
  );
}
