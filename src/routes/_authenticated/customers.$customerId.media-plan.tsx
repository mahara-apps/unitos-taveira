import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CheckCircle2,
  GripVertical,
  Link2,
  Loader2,
  Plus,
  Rocket,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { DashboardPageShell } from "@/components/ui/dashboard-primitives";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import { cn } from "@/lib/utils";
import {
  createMediaPlan,
  deleteMediaPlan,
  deleteMediaPlanItem,
  getMediaPlan,
  issueMediaPlanShareToken,
  listMediaPlans,
  reorderMediaPlanItems,
  revokeMediaPlanShareToken,
  updateMediaPlan,
  upsertMediaPlanItem,
  type MediaPlan,
  type MediaPlanItem,
} from "@/lib/media-plans.functions";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";

type MediaPlanSearch = {
  planId?: string;
  stage?: "topo" | "meio" | "fundo";
  channel?: string;
};
const searchSchema = z.object({
  planId: z.string().uuid().optional(),
  stage: z.enum(["topo", "meio", "fundo"]).optional(),
  channel: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/customers/$customerId/media-plan")({
  beforeLoad: () => ensureFeatureEnabled("midia_paga"),
  validateSearch: (raw: Record<string, unknown>): MediaPlanSearch => searchSchema.parse(raw),
  component: MediaPlanPage,
});

const STAGE_LABEL: Record<string, string> = { topo: "Topo", meio: "Meio", fundo: "Fundo" };
const STAGE_TONE: Record<string, string> = {
  topo: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  meio: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  fundo: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};
const CAMPAIGN_TYPES = [
  "Awareness",
  "Tráfego",
  "Engajamento",
  "Conversão",
  "Leads",
  "Vendas",
  "Alcance",
  "Retargeting",
  "Instalação de app",
];
const CHANNEL_OPTIONS = [
  "Meta Ads",
  "Instagram",
  "Facebook",
  "Google Ads",
  "YouTube",
  "TikTok Ads",
  "LinkedIn Ads",
  "Pinterest",
  "Twitter/X Ads",
  "Programática",
  "E-mail",
  "Influenciadores",
];

const currency = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);

function MediaPlanPage() {
  const { customerId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { brandId, setClientId } = useActiveContext();
  const qc = useQueryClient();

  useEffect(() => {
    if (customerId) setClientId(customerId);
  }, [customerId, setClientId]);

  const listFn = useServerFn(listMediaPlans);
  const plansQ = useQuery({
    queryKey: ["media-plans", customerId],
    queryFn: () => listFn({ data: { clientId: customerId } }),
    enabled: !!customerId,
  });

  const plans = plansQ.data?.plans ?? [];
  const activePlanId = search.planId ?? plans[0]?.id;

  const getFn = useServerFn(getMediaPlan);
  const planQ = useQuery({
    queryKey: ["media-plan", activePlanId],
    queryFn: () => getFn({ data: { planId: activePlanId! } }),
    enabled: !!activePlanId,
  });

  // Create plan
  const createFn = useServerFn(createMediaPlan);
  const [creating, setCreating] = useState(false);
  const createMut = useMutation({
    mutationFn: async (payload: {
      title: string;
      monthly_budget: number;
      period_start?: string;
      period_end?: string;
    }) => {
      if (!brandId) throw new Error("workspace_required");
      return createFn({
        data: {
          brandId,
          clientId: customerId,
          title: payload.title || "Plano de mídia",
          monthly_budget: payload.monthly_budget,
          period_start: payload.period_start || null,
          period_end: payload.period_end || null,
        },
      });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["media-plans", customerId] });
      setCreating(false);
      navigate({
        to: ".",
        search: (prev: MediaPlanSearch) => ({ ...prev, planId: r.plan.id }),
        replace: true,
      });
      toast.success("Plano criado");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao criar plano"),
  });

  const updateFn = useServerFn(updateMediaPlan);
  type UpdatePatch = {
    title?: string;
    period_start?: string | null;
    period_end?: string | null;
    monthly_budget?: number;
    status?: "draft" | "approved" | "archived";
  };
  const updateMut = useMutation({
    mutationFn: (payload: { patch: UpdatePatch }) =>
      updateFn({ data: { planId: activePlanId!, patch: payload.patch } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media-plan", activePlanId] });
      qc.invalidateQueries({ queryKey: ["media-plans", customerId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao salvar"),
  });

  const deleteFn = useServerFn(deleteMediaPlan);
  const deletePlanMut = useMutation({
    mutationFn: () => deleteFn({ data: { planId: activePlanId! } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media-plans", customerId] });
      navigate({
        to: ".",
        search: (prev: MediaPlanSearch) => ({ ...prev, planId: undefined }),
        replace: true,
      });
      toast.success("Plano excluído");
    },
  });

  const [shareOpen, setShareOpen] = useState(false);

  usePageHeader(
    {
      title: "Plano de mídia paga",
      subtitle: plans[0]
        ? `${plans.length} plano${plans.length > 1 ? "s" : ""} · ${planQ.data?.plan.title ?? ""}`
        : "Nenhum plano criado",
      actions: (
        <div className="flex items-center gap-2">
          {plans.length > 0 && (
            <Select
              value={activePlanId ?? ""}
              onValueChange={(v) =>
                navigate({
                  to: ".",
                  search: (p: MediaPlanSearch) => ({ ...p, planId: v }),
                  replace: true,
                })
              }
            >
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue placeholder="Selecionar plano" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title} {p.status === "approved" ? "· ✓" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {activePlanId && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setShareOpen(true)}
              >
                <Share2 className="mr-2 h-4 w-4" /> Compartilhar
              </Button>
              {planQ.data?.plan.status !== "approved" ? (
                <Button
                  size="sm"
                  className="h-9"
                  onClick={() => updateMut.mutate({ patch: { status: "approved" } })}
                  disabled={updateMut.isPending}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Aprovar
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9"
                  onClick={() => updateMut.mutate({ patch: { status: "draft" } })}
                >
                  Reabrir
                </Button>
              )}
            </>
          )}
          <Button size="sm" className="h-9 gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Novo plano
          </Button>
        </div>
      ),
    },
    [plans.length, activePlanId, planQ.data?.plan.status, updateMut.isPending],
  );

  return (
    <DashboardPageShell>
      {plansQ.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : plans.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : !activePlanId || !planQ.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <PlanEditor
          plan={planQ.data.plan}
          items={planQ.data.items}
          searchStage={search.stage}
          searchChannel={search.channel}
          onSearch={(patch) =>
            navigate({
              to: ".",
              search: (p: MediaPlanSearch) => ({ ...p, ...patch }),
              replace: true,
            })
          }
          onUpdatePlan={(patch) => updateMut.mutate({ patch })}
          onDeletePlan={() => {
            if (confirm("Excluir este plano? Esta ação é irreversível.")) deletePlanMut.mutate();
          }}
        />
      )}

      <CreatePlanDialog
        open={creating}
        onOpenChange={setCreating}
        pending={createMut.isPending}
        onCreate={(p) => createMut.mutate(p)}
      />

      {activePlanId && (
        <ShareDialog open={shareOpen} onOpenChange={setShareOpen} plan={planQ.data?.plan ?? null} />
      )}
    </DashboardPageShell>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/40 px-6 py-16 text-center">
      <Rocket className="mb-4 h-10 w-10 text-muted-foreground" />
      <div className="mb-1 text-lg font-medium">Comece um plano de mídia paga</div>
      <div className="mb-6 max-w-md text-sm text-muted-foreground">
        Estruture as campanhas por etapa do funil, defina o orçamento por canal e compartilhe a
        versão de apresentação com o cliente por link.
      </div>
      <Button onClick={onCreate}>
        <Plus className="mr-2 h-4 w-4" /> Criar plano
      </Button>
    </div>
  );
}

function CreatePlanDialog({
  open,
  onOpenChange,
  pending,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: boolean;
  onCreate: (p: {
    title: string;
    monthly_budget: number;
    period_start?: string;
    period_end?: string;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [budget, setBudget] = useState(0);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBudget(0);
    setStart("");
    setEnd("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo plano de mídia</DialogTitle>
          <DialogDescription>Defina o título, o período e o orçamento mensal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Título</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Plano Q1 2026"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Orçamento mensal (R$)
            </label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={budget || ""}
              onChange={(e) => setBudget(Number(e.target.value) || 0)}
              placeholder="10000"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Início</label>
              <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fim</label>
              <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onCreate({
                title,
                monthly_budget: budget,
                period_start: start || undefined,
                period_end: end || undefined,
              })
            }
            disabled={pending}
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Criar plano
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- Editor -------------------------------- */

function PlanEditor({
  plan,
  items,
  searchStage,
  searchChannel,
  onSearch,
  onUpdatePlan,
  onDeletePlan,
}: {
  plan: MediaPlan;
  items: MediaPlanItem[];
  searchStage: "topo" | "meio" | "fundo" | undefined;
  searchChannel: string | undefined;
  onSearch: (patch: { stage?: "topo" | "meio" | "fundo"; channel?: string }) => void;
  onUpdatePlan: (patch: { monthly_budget?: number; title?: string }) => void;
  onDeletePlan: () => void;
}) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertMediaPlanItem);
  const deleteFn = useServerFn(deleteMediaPlanItem);
  const reorderFn = useServerFn(reorderMediaPlanItems);

  type UpsertItem = {
    id?: string;
    position?: number;
    product_service?: string | null;
    campaign_type?: string | null;
    funnel_stage?: "topo" | "meio" | "fundo" | null;
    objective?: string | null;
    main_kpi?: string | null;
    channel?: string | null;
    audience?: string | null;
    budget_pct?: number;
    keywords?: string[];
    benchmark?: string | null;
    other_refs?: string | null;
  };
  const upsertMut = useMutation({
    mutationFn: (payload: { item: UpsertItem }) =>
      upsertFn({ data: { planId: plan.id, item: payload.item } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media-plan", plan.id] }),
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao salvar linha"),
  });
  const deleteMut = useMutation({
    mutationFn: (itemId: string) => deleteFn({ data: { itemId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media-plan", plan.id] }),
  });
  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => reorderFn({ data: { planId: plan.id, orderedIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["media-plan", plan.id] }),
  });

  const [localItems, setLocalItems] = useState<MediaPlanItem[]>(items);
  useEffect(() => setLocalItems(items), [items]);

  const totalPct = useMemo(
    () => localItems.reduce((s, i) => s + (Number(i.budget_pct) || 0), 0),
    [localItems],
  );
  const totalAmount = useMemo(
    () => localItems.reduce((s, i) => s + (Number(i.budget_amount) || 0), 0),
    [localItems],
  );

  const channelsInUse = useMemo(
    () => Array.from(new Set(localItems.map((i) => i.channel).filter(Boolean))) as string[],
    [localItems],
  );

  const filtered = localItems.filter(
    (i) =>
      (!searchStage || i.funnel_stage === searchStage) &&
      (!searchChannel || i.channel === searchChannel),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIdx = localItems.findIndex((i) => i.id === e.active.id);
    const newIdx = localItems.findIndex((i) => i.id === e.over!.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(localItems, oldIdx, newIdx);
    setLocalItems(next);
    reorderMut.mutate(next.map((n) => n.id));
  };

  const addRow = () =>
    upsertMut.mutate({
      item: {
        product_service: "",
        campaign_type: null,
        funnel_stage: null,
        objective: "",
        main_kpi: "",
        channel: null,
        audience: "",
        budget_pct: 0,
        keywords: [],
        benchmark: "",
        other_refs: "",
      },
    });

  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<string>(String(plan.monthly_budget));
  useEffect(() => setBudgetDraft(String(plan.monthly_budget)), [plan.monthly_budget]);

  const overBudget = totalPct > 100;
  const nearBudget = totalPct >= 95 && totalPct <= 100;

  return (
    <div className="space-y-4">
      {/* Allocation bar */}
      <div className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Orçamento mensal
            </div>
            {editingBudget ? (
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  autoFocus
                  className="h-9 w-40"
                  value={budgetDraft}
                  onChange={(e) => setBudgetDraft(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => {
                    const v = Number(budgetDraft) || 0;
                    onUpdatePlan({ monthly_budget: v });
                    setEditingBudget(false);
                  }}
                >
                  Salvar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingBudget(false)}>
                  Cancelar
                </Button>
              </div>
            ) : (
              <button
                type="button"
                className="mt-0.5 text-2xl font-semibold tracking-tight hover:underline"
                onClick={() => setEditingBudget(true)}
              >
                {currency(plan.monthly_budget)}
              </button>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Alocado
            </div>
            <div
              className={cn(
                "text-2xl font-semibold tracking-tight",
                overBudget && "text-rose-500",
                nearBudget && "text-amber-500",
                !overBudget && !nearBudget && "text-emerald-500",
              )}
            >
              {currency(totalAmount)}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · {totalPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full transition-all",
              overBudget ? "bg-rose-500" : nearBudget ? "bg-amber-500" : "bg-emerald-500",
            )}
            style={{ width: `${Math.min(100, totalPct)}%` }}
          />
        </div>
        {overBudget && (
          <div className="mt-2 text-xs text-rose-500">
            Alocação acima de 100% ({totalPct.toFixed(1)}%). Ajuste as porcentagens para fechar a
            distribuição.
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={searchStage ?? ""}
          onChange={(e) => onSearch({ stage: (e.target.value || undefined) as never })}
          className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm"
        >
          <option value="">Todas etapas</option>
          <option value="topo">Topo do funil</option>
          <option value="meio">Meio do funil</option>
          <option value="fundo">Fundo do funil</option>
        </select>
        <select
          value={searchChannel ?? ""}
          onChange={(e) => onSearch({ channel: e.target.value || undefined })}
          className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm"
        >
          <option value="">Todos canais</option>
          {channelsInUse.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {(searchStage || searchChannel) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSearch({ stage: undefined, channel: undefined })}
          >
            <X className="mr-1 h-3.5 w-3.5" /> Limpar
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={addRow}
            disabled={upsertMut.isPending}
          >
            <Plus className="mr-2 h-4 w-4" /> Adicionar linha
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 text-rose-500 hover:text-rose-500"
            onClick={onDeletePlan}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Excluir plano
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card">
        <div className="min-w-[1400px]">
          <div className="grid grid-cols-[28px_1.4fr_1fr_0.9fr_1.4fr_1fr_1fr_1.2fr_100px_120px_1.2fr_1fr_1fr_32px] items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span />
            <span>Produto/Serviço</span>
            <span>Tipo de campanha</span>
            <span>Etapa</span>
            <span>Objetivo</span>
            <span>KPI</span>
            <span>Canal</span>
            <span>Público</span>
            <span className="text-right">%</span>
            <span className="text-right">R$</span>
            <span>Palavras-chave</span>
            <span>Benchmark</span>
            <span>Outras refs</span>
            <span />
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={filtered.map((i) => i.id)}
              strategy={verticalListSortingStrategy}
            >
              {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nenhum item{searchStage || searchChannel ? " para os filtros aplicados" : ""}.
                </div>
              ) : (
                filtered.map((item) => (
                  <EditableRow
                    key={item.id}
                    item={item}
                    monthlyBudget={plan.monthly_budget}
                    onChange={(patch) => upsertMut.mutate({ item: { id: item.id, ...patch } })}
                    onDelete={() => deleteMut.mutate(item.id)}
                  />
                ))
              )}
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  );
}

function EditableRow({
  item,
  monthlyBudget,
  onChange,
  onDelete,
}: {
  item: MediaPlanItem;
  monthlyBudget: number;
  onChange: (patch: Partial<MediaPlanItem>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const [local, setLocal] = useState(item);
  useEffect(() => setLocal(item), [item]);

  const debouncedRef = useRef<number | null>(null);
  const change = <K extends keyof MediaPlanItem>(key: K, value: MediaPlanItem[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
    if (debouncedRef.current) window.clearTimeout(debouncedRef.current);
    debouncedRef.current = window.setTimeout(() => {
      onChange({ [key]: value } as Partial<MediaPlanItem>);
    }, 450);
  };

  const previewAmount = ((Number(monthlyBudget) || 0) * (Number(local.budget_pct) || 0)) / 100;

  const kwText = (local.keywords ?? []).join(", ");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="grid grid-cols-[28px_1.4fr_1fr_0.9fr_1.4fr_1fr_1fr_1.2fr_100px_120px_1.2fr_1fr_1fr_32px] items-center gap-2 border-b border-border/40 px-3 py-2 text-sm hover:bg-muted/20"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        className="h-8"
        value={local.product_service ?? ""}
        onChange={(e) => change("product_service", e.target.value)}
        placeholder="Produto ou serviço"
      />
      <select
        value={local.campaign_type ?? ""}
        onChange={(e) => change("campaign_type", (e.target.value || null) as never)}
        className="h-8 rounded-md border border-border/60 bg-background px-2 text-sm"
      >
        <option value="">—</option>
        {CAMPAIGN_TYPES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        value={local.funnel_stage ?? ""}
        onChange={(e) => change("funnel_stage", (e.target.value || null) as never)}
        className="h-8 rounded-md border border-border/60 bg-background px-2 text-sm"
      >
        <option value="">—</option>
        <option value="topo">Topo</option>
        <option value="meio">Meio</option>
        <option value="fundo">Fundo</option>
      </select>
      <Input
        className="h-8"
        value={local.objective ?? ""}
        onChange={(e) => change("objective", e.target.value)}
        placeholder="Objetivo"
      />
      <Input
        className="h-8"
        value={local.main_kpi ?? ""}
        onChange={(e) => change("main_kpi", e.target.value)}
        placeholder="Ex.: CPL < R$ 20"
      />
      <select
        value={local.channel ?? ""}
        onChange={(e) => change("channel", (e.target.value || null) as never)}
        className="h-8 rounded-md border border-border/60 bg-background px-2 text-sm"
      >
        <option value="">—</option>
        {CHANNEL_OPTIONS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <Input
        className="h-8"
        value={local.audience ?? ""}
        onChange={(e) => change("audience", e.target.value)}
        placeholder="Público"
      />
      <Input
        type="number"
        className="h-8 text-right"
        value={local.budget_pct ?? 0}
        min={0}
        max={100}
        step={0.5}
        onChange={(e) => change("budget_pct", Number(e.target.value) || 0)}
      />
      <div className="text-right text-sm tabular-nums text-muted-foreground">
        {currency(previewAmount)}
      </div>
      <Input
        className="h-8"
        value={kwText}
        onChange={(e) =>
          change(
            "keywords",
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        placeholder="palavra1, palavra2"
      />
      <Input
        className="h-8"
        value={local.benchmark ?? ""}
        onChange={(e) => change("benchmark", e.target.value)}
        placeholder="CTR 1,2%"
      />
      <Input
        className="h-8"
        value={local.other_refs ?? ""}
        onChange={(e) => change("other_refs", e.target.value)}
        placeholder="Links/refs"
      />
      <button
        type="button"
        onClick={onDelete}
        className="text-muted-foreground hover:text-rose-500"
        title="Excluir linha"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/* --------------------------------- Share -------------------------------- */

function ShareDialog({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plan: MediaPlan | null;
}) {
  const qc = useQueryClient();
  const issueFn = useServerFn(issueMediaPlanShareToken);
  const revokeFn = useServerFn(revokeMediaPlanShareToken);
  const [expires, setExpires] = useState<number | null>(30);

  const issueMut = useMutation({
    mutationFn: () => issueFn({ data: { planId: plan!.id, expiresInDays: expires } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media-plan", plan?.id] });
      toast.success("Link gerado");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const revokeMut = useMutation({
    mutationFn: () => revokeFn({ data: { planId: plan!.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media-plan", plan?.id] });
      toast.success("Link revogado");
    },
  });

  const url =
    plan?.share_token && typeof window !== "undefined"
      ? `${window.location.origin}/plano/${plan.id}?token=${plan.share_token}`
      : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Compartilhar apresentação</DialogTitle>
          <DialogDescription>
            O cliente vê uma versão de apresentação, sem qualquer painel interno.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {plan?.share_token ? (
            <>
              <div className="flex items-center gap-2">
                <Input readOnly value={url} className="h-9" />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(url);
                    toast.success("Link copiado");
                  }}
                >
                  <Link2 className="mr-2 h-4 w-4" /> Copiar
                </Button>
              </div>
              {plan.share_expires_at && (
                <div className="text-xs text-muted-foreground">
                  Expira em {new Date(plan.share_expires_at).toLocaleDateString("pt-BR")}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
              Nenhum link ativo. Gere um novo para compartilhar com o cliente.
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Validade:</label>
            <select
              value={expires ?? "never"}
              onChange={(e) =>
                setExpires(e.target.value === "never" ? null : Number(e.target.value))
              }
              className="h-8 rounded-md border border-border/60 bg-background px-2 text-sm"
            >
              <option value={7}>7 dias</option>
              <option value={30}>30 dias</option>
              <option value={90}>90 dias</option>
              <option value="never">Sem expiração</option>
            </select>
          </div>
        </div>
        <DialogFooter>
          {plan?.share_token && (
            <Button
              variant="ghost"
              onClick={() => revokeMut.mutate()}
              disabled={revokeMut.isPending}
            >
              Revogar link
            </Button>
          )}
          <Button onClick={() => issueMut.mutate()} disabled={issueMut.isPending}>
            {issueMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {plan?.share_token ? "Gerar novo" : "Gerar link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// keep imports referenced
void STAGE_LABEL;
void STAGE_TONE;
void Badge;
void Textarea;
