import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  XCircle,
} from "lucide-react";

import {
  INSTALLATION_STATUS_LABEL,
  type InstallationStatus,
} from "@/lib/installation/manager-contract";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Tom visual por status da instalação — usado na lista e no detalhe. */
export const STATUS_TONE: Record<InstallationStatus, string> = {
  preparing: "border-border/60 text-muted-foreground",
  provisioning: "border-severity-info/40 text-severity-info",
  validating: "border-severity-info/40 text-severity-info",
  update_available: "border-severity-warning/40 text-severity-warning",
  up_to_date: "border-health-good/40 text-health-good",
  attention: "border-severity-warning/40 text-severity-warning",
  error: "border-destructive/40 text-destructive",
};

/** Etapas do ciclo de vida de uma instalação. */
export const LIFECYCLE = ["Cadastrar", "Provisionar", "Validar", "Configurar", "Pronto"] as const;

export function lifecycleIndex(i: {
  status: InstallationStatus;
  lastProvisionedAt: string | null;
  lastValidatedAt: string | null;
}): number {
  if (i.status === "up_to_date") return 4;
  if (i.lastValidatedAt) return 3;
  if (i.lastProvisionedAt) return 2;
  if (i.status === "provisioning" || i.status === "validating") return 1;
  return 0;
}

/** Trilha compacta: pontos + rótulo da etapa atual, sem repetir cinco cápsulas. */
export function LifecycleTrail({
  activeIndex,
  showLabel = true,
  complete = false,
}: {
  activeIndex: number;
  showLabel?: boolean;
  /** Ciclo concluído: a última etapa é CONCLUÍDA (verde), não "atual" (azul). */
  complete?: boolean;
}) {
  const done = complete ? LIFECYCLE.length : activeIndex;
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        {LIFECYCLE.map((label, index) => (
          <span
            key={label}
            title={label}
            className={cn(
              "h-1.5 rounded-full transition-all",
              index < done && "w-1.5 bg-health-good",
              !complete && index === activeIndex && "w-5 bg-primary",
              index >= done && !(!complete && index === activeIndex) && "w-1.5 bg-border",
            )}
          />
        ))}
      </div>
      {showLabel && (
        <span
          className={cn(
            "flex items-center gap-1 text-[11px]",
            complete ? "font-medium text-health-good" : "text-muted-foreground",
          )}
        >
          {complete ? (
            <>
              <Check className="h-3 w-3" /> Pronto
            </>
          ) : (
            `Etapa ${activeIndex + 1}/${LIFECYCLE.length} · ${LIFECYCLE[activeIndex]}`
          )}
        </span>
      )}
    </div>
  );
}

/** Trilha completa em etapas — usada no topo da tela de detalhe. */
export function LifecycleSteps({
  activeIndex,
  complete = false,
}: {
  activeIndex: number;
  /** Ciclo concluído: TODAS as etapas ficam verdes, inclusive "Pronto". */
  complete?: boolean;
}) {
  const done = complete ? LIFECYCLE.length : activeIndex;
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {LIFECYCLE.map((label, index) => {
        const isDone = index < done;
        const isCurrent = !complete && index === activeIndex;
        return (
          <li
            key={label}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5",
              isDone && "border-health-good/40 bg-health-good/10 text-health-good",
              isCurrent && "border-primary/50 bg-primary/10 text-primary",
              !isDone && !isCurrent && "border-border/60 text-muted-foreground",
            )}
          >
            {isDone && <Check className="h-3 w-3" />}
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export function StatusBadge({ status }: { status: InstallationStatus }) {
  return (
    <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[status])}>
      {INSTALLATION_STATUS_LABEL[status]}
    </Badge>
  );
}

export type VisualState = "ok" | "attention" | "error" | "pending" | "running";

const STATE_TONE: Record<VisualState, string> = {
  ok: "border-health-good/40 text-health-good",
  attention: "border-severity-warning/40 text-severity-warning",
  error: "border-destructive/40 text-destructive",
  pending: "border-border/60 text-muted-foreground",
  running: "border-severity-info/40 text-severity-info",
};

const STATE_ICON: Record<VisualState, ReactNode> = {
  ok: <CheckCircle2 className="h-3 w-3" />,
  attention: <AlertTriangle className="h-3 w-3" />,
  error: <XCircle className="h-3 w-3" />,
  pending: <CircleDashed className="h-3 w-3" />,
  running: <Loader2 className="h-3 w-3 animate-spin" />,
};

/** Etiqueta de estado com ícone — não depende só de cor. */
export function StateBadge({
  state,
  label,
  className,
}: {
  state: VisualState;
  label: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 text-[10px] font-medium", STATE_TONE[state], className)}
    >
      {STATE_ICON[state]}
      {label}
    </Badge>
  );
}

/** Versão sempre exibida como `v1.0.0`. */
export function formatVersion(version: string | null | undefined): string {
  const v = (version ?? "").trim();
  if (!v) return "—";
  return /^v/i.test(v) ? `v${v.slice(1)}` : `v${v}`;
}

/** Par de versões: instalada × disponível, com veredito visual. */
export function VersionPair({
  installed,
  available,
  compact = false,
}: {
  installed: string | null;
  available: string;
  compact?: boolean;
}) {
  const upToDate = !!installed && installed === available;
  return (
    <div className={cn("flex items-center gap-2", compact ? "text-[11px]" : "text-xs")}>
      <span className="font-mono text-foreground">{formatVersion(installed)}</span>
      <span className="text-muted-foreground">→</span>
      <span className="font-mono text-muted-foreground">{formatVersion(available)}</span>
      <StateBadge
        state={upToDate ? "ok" : "attention"}
        label={upToDate ? "Em dia" : "Atualização disponível"}
      />
    </div>
  );
}

/** Célula de dado com rótulo em caixa alta pequena. */
export function DataCell({
  label,
  value,
  mono = false,
  children,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children ?? (
        <p className={cn("mt-0.5 truncate text-xs", mono && "font-mono")} title={value ?? "—"}>
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}

export function DataGrid({
  columns = 3,
  children,
}: {
  columns?: 2 | 3 | 4;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-2.5",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
      )}
    >
      {children}
    </div>
  );
}


/* ------------------------------------------------------- LISTA COM MARCAÇÕES */

/**
 * Uma linha de conferência: ícone de estado + rótulo + valor à direita.
 * Substitui pilhas de badges — o estado é legível sem depender de cor.
 */
export function CheckRow({
  state,
  label,
  value,
  className,
}: {
  state: VisualState;
  label: string;
  value?: ReactNode;
  className?: string;
}) {
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 py-1.5 text-xs",
        "border-b border-border/40 last:border-b-0",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("shrink-0", STATE_TONE[state].split(" ").pop())}>
          {STATE_ICON[state]}
        </span>
        <span className="truncate font-medium text-foreground">{label}</span>
      </span>
      <span className="shrink-0 text-right text-[11px] text-muted-foreground">{value ?? "—"}</span>
    </li>
  );
}

export function CheckList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("divide-border/40", className)}>{children}</ul>;
}

/**
 * Bloco recolhível para itens que NÃO bloqueiam a instalação: mostra só o
 * contador e abre a lista sob demanda, em vez de espalhar uma cápsula por item.
 */
export function CollapsibleChecks({
  label,
  summary,
  state = "pending",
  children,
  defaultOpen = false,
}: {
  label: string;
  summary: string;
  state?: VisualState;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 py-1.5 text-left text-xs"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("shrink-0", STATE_TONE[state].split(" ").pop())}>
            {STATE_ICON[state]}
          </span>
          <span className="truncate font-medium text-foreground">{label}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          {summary}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <ul className="mb-1.5 ml-5 border-l border-border/50 pl-3">{children}</ul>}
    </div>
  );
}
