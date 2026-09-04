/**
 * Metadados de status da pauta (Planejamento mensal) compartilhados entre
 * a tela de pauta e o módulo de projetos. Visual idêntico em todos os lugares.
 */

export type PlanStatus =
  | "draft"
  | "pending_client"
  | "client_approved"
  | "changes_requested"
  | "client_rejected"
  | "approved"
  | "archived";

export const PLAN_STATUS_META: Record<PlanStatus, { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  pending_client: {
    label: "No cliente",
    cls: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  },
  changes_requested: {
    label: "Ajustes pedidos",
    cls: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  },
  client_rejected: {
    label: "Cliente rejeitou",
    cls: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  },
  client_approved: {
    label: "Cliente aprovou",
    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  approved: {
    label: "Em produção",
    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  },
  archived: { label: "Arquivada", cls: "bg-muted text-muted-foreground border-border" },
};

export function planStatusMeta(status: string | null | undefined) {
  return PLAN_STATUS_META[(status ?? "draft") as PlanStatus] ?? PLAN_STATUS_META.draft;
}

export function PlanStatusBadge({
  status,
  className = "",
  prefix,
}: {
  status: string | null | undefined;
  className?: string;
  prefix?: string;
}) {
  const meta = planStatusMeta(status);
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium uppercase tracking-wide ${meta.cls} ${className}`}
    >
      {prefix ? <span className="opacity-70">{prefix}</span> : null}
      {meta.label}
    </span>
  );
}
