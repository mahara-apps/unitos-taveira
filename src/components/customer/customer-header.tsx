// Cabeçalho de identidade do cliente (Painel do Cliente).
// Só apresentação: recebe dados já carregados pela rota e ações prontas.
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

function initialsOf(name: string | null | undefined) {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function CustomerHeader({
  name,
  niche,
  color,
  isActive,
  briefingCompletion,
  actions,
}: {
  name: string | null | undefined;
  niche?: string | null;
  color?: string | null;
  isActive?: boolean | null;
  /** 0–100; omita quando ainda não foi carregado. */
  briefingCompletion?: number | null;
  actions?: ReactNode;
}) {
  const initials = initialsOf(name) || "?";
  const inactive = isActive === false;

  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-base font-semibold text-primary ring-1 ring-primary/20 sm:h-14 sm:w-14 sm:text-lg"
          style={color ? { backgroundColor: `${color}22`, color } : undefined}
        >
          <span className={cn(!color && "text-primary")}>{initials}</span>
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {name ?? "Cliente"}
          </h1>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="truncate">{niche || "Sem segmento definido"}</span>
            {inactive ? (
              <>
                <span aria-hidden>·</span>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
                  Conta inativa
                </Badge>
              </>
            ) : null}
            {typeof briefingCompletion === "number" ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">Briefing {briefingCompletion}% completo</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
