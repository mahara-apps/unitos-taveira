import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Plus, Search, Share2, Sparkles, Target } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DashboardPageShell } from "@/components/ui/dashboard-primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import { cn } from "@/lib/utils";
import { listBrandMediaPlans, type BrandMediaPlanRow } from "@/lib/media-plans-index.functions";
import { CreateMediaPlanDialog } from "@/components/media-plans/create-media-plan-dialog";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";

export const Route = createFileRoute("/_authenticated/media-plans")({
  beforeLoad: () => ensureFeatureEnabled("midia_paga"),
  component: MediaPlansIndex,
});

const currency = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  approved: "Aprovado",
  archived: "Arquivado",
};

function MediaPlansIndex() {
  const { brandId, clientId } = useActiveContext();
  const listFn = useServerFn(listBrandMediaPlans);
  const q = useQuery({
    queryKey: ["brand-media-plans", brandId, clientId ?? "all"],
    queryFn: () => listFn({ data: { brandId: brandId!, clientId: clientId ?? null } }),
    enabled: !!brandId,
  });

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "draft" | "approved" | "archived">("all");
  const [dialog, setDialog] = useState<{ open: boolean; mode: "manual" | "ai" }>({
    open: false,
    mode: "manual",
  });

  const plans = useMemo(() => q.data?.plans ?? [], [q.data]);

  const kpis = useMemo(() => {
    const totalBudget = plans.reduce((s, p) => s + p.monthly_budget, 0);
    const approved = plans.filter((p) => p.status === "approved").length;
    const drafts = plans.filter((p) => p.status === "draft").length;
    return { total: plans.length, totalBudget, approved, drafts };
  }, [plans]);

  const filtered = plans.filter((p) => {
    if (status !== "all" && p.status !== status) return false;
    if (search && !`${p.title} ${p.client_name}`.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  usePageHeader(
    {
      title: "Mídia paga",
      subtitle: `${plans.length} plano${plans.length === 1 ? "" : "s"} no workspace`,
      actions: brandId ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Novo plano
              <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Criar plano de mídia
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setDialog({ open: true, mode: "manual" })}
              className="gap-2"
            >
              <Target className="h-4 w-4 text-muted-foreground" />
              <div className="grid">
                <span className="text-sm font-medium">Criar manualmente</span>
                <span className="text-[11px] text-muted-foreground">
                  Você define cliente, período e orçamento
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => setDialog({ open: true, mode: "ai" })}
              className="gap-2"
            >
              <Sparkles className="h-4 w-4 text-violet-500" />
              <div className="grid">
                <span className="text-sm font-medium">Gerar com IA</span>
                <span className="text-[11px] text-muted-foreground">
                  A IA monta 6–10 iniciativas balanceando funil
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null,
    },
    [plans.length, brandId],
  );

  return (
    <DashboardPageShell>
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Planos" value={String(kpis.total)} icon={<Target className="h-4 w-4" />} />
        <KpiCard label="Investimento mensal" value={currency(kpis.totalBudget)} tone="sky" />
        <KpiCard
          label="Aprovados"
          value={String(kpis.approved)}
          tone="emerald"
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
        <KpiCard label="Em rascunho" value={String(kpis.drafts)} tone="amber" />
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título ou cliente…"
            className="h-9 w-72 pl-8"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm"
        >
          <option value="all">Todos status</option>
          <option value="draft">Rascunho</option>
          <option value="approved">Aprovado</option>
          <option value="archived">Arquivado</option>
        </select>
      </div>

      {/* List */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card">
        {q.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasAny={plans.length > 0} />
        ) : (
          <>
            <div className="grid grid-cols-[1.6fr_1fr_120px_140px_140px_120px] gap-2 border-b border-border/60 bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <span>Plano</span>
              <span>Cliente</span>
              <span>Status</span>
              <span className="text-right">Orçamento</span>
              <span className="text-right">Alocado</span>
              <span className="text-right">Itens</span>
            </div>
            {filtered.map((p) => (
              <PlanRow key={p.id} plan={p} />
            ))}
          </>
        )}
      </div>
      {brandId && (
        <CreateMediaPlanDialog
          open={dialog.open}
          mode={dialog.mode}
          brandId={brandId}
          onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}
        />
      )}
    </DashboardPageShell>
  );
}

function PlanRow({ plan }: { plan: BrandMediaPlanRow }) {
  const over = plan.allocated_pct > 100;
  const near = plan.allocated_pct >= 95 && plan.allocated_pct <= 100;
  return (
    <Link
      to="/customers/$customerId/media-plan"
      params={{ customerId: plan.client_id }}
      search={{ planId: plan.id }}
      className="grid grid-cols-[1.6fr_1fr_120px_140px_140px_120px] items-center gap-2 border-b border-border/40 px-4 py-3 text-sm transition hover:bg-muted/30"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{plan.title}</span>
          {plan.share_token && (
            <Share2
              className="h-3 w-3 text-muted-foreground"
              aria-label="Link compartilhado ativo"
            />
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Atualizado em {new Date(plan.updated_at).toLocaleDateString("pt-BR")}
          {plan.period_start ? ` · ${new Date(plan.period_start).toLocaleDateString("pt-BR")}` : ""}
          {plan.period_end ? ` — ${new Date(plan.period_end).toLocaleDateString("pt-BR")}` : ""}
        </div>
      </div>
      <div className="truncate text-muted-foreground">{plan.client_name}</div>
      <div>
        <StatusBadge status={plan.status} />
      </div>
      <div className="text-right tabular-nums">{currency(plan.monthly_budget)}</div>
      <div className="text-right">
        <div
          className={cn(
            "tabular-nums",
            over && "text-rose-500",
            near && "text-amber-500",
            !over && !near && "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {currency(plan.allocated_amount)}
        </div>
        <div className="text-[10px] text-muted-foreground">{plan.allocated_pct.toFixed(1)}%</div>
      </div>
      <div className="text-right text-muted-foreground">{plan.items_count}</div>
    </Link>
  );
}

function StatusBadge({ status }: { status: BrandMediaPlanRow["status"] }) {
  const tone: Record<string, string> = {
    draft: "border-border/60 bg-muted text-muted-foreground",
    approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    archived: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };
  return (
    <Badge variant="outline" className={cn("gap-1", tone[status])}>
      {status === "approved" && <CheckCircle2 className="mr-1 h-3 w-3" />}
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <Target className="mb-3 h-8 w-8 text-muted-foreground" />
      <div className="text-sm font-medium">
        {hasAny ? "Nenhum plano para os filtros aplicados" : "Nenhum plano criado ainda"}
      </div>
      <div className="mt-1 max-w-md text-xs text-muted-foreground">
        {hasAny
          ? "Ajuste os filtros para ver outros planos."
          : "Abra um cliente e crie o primeiro plano na aba Plano de mídia."}
      </div>
    </div>
  );
}
