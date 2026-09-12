import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  ChevronDown,
  ChevronRight,
  GripVertical,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Trash2,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteMediaPlanItem,
  reorderMediaPlanItems,
  upsertMediaPlanItem,
  type MediaPlan,
  type MediaPlanItem,
} from "@/lib/media-plans.functions";
import { cn } from "@/lib/utils";

export type MediaPlanStage = "topo" | "meio" | "fundo";
type ViewMode = "cards" | "sheet";
type StageVisual = {
  id: MediaPlanStage | "unassigned";
  label: string;
  shortLabel: string;
  bar: string;
  soft: string;
  text: string;
  dot: string;
};

type ItemDraft = {
  id?: string;
  product_service: string;
  campaign_type: string;
  funnel_stage: MediaPlanStage;
  objective: string;
  main_kpi: string;
  channel: string;
  audience: string;
  budget_pct: number;
  keywords: string;
  benchmark: string;
  other_refs: string;
};

type UpsertItem = {
  id?: string;
  position?: number;
  product_service?: string | null;
  campaign_type?: string | null;
  funnel_stage?: MediaPlanStage | null;
  objective?: string | null;
  main_kpi?: string | null;
  channel?: string | null;
  audience?: string | null;
  budget_pct?: number;
  keywords?: string[];
  benchmark?: string | null;
  other_refs?: string | null;
};

const STAGES = [
  { id: "topo", label: "Topo do funil", shortLabel: "Topo", bar: "bg-funnel-top", soft: "bg-funnel-top/10", text: "text-funnel-top", dot: "bg-funnel-top" },
  { id: "meio", label: "Meio do funil", shortLabel: "Meio", bar: "bg-funnel-middle", soft: "bg-funnel-middle/10", text: "text-funnel-middle", dot: "bg-funnel-middle" },
  { id: "fundo", label: "Fundo do funil", shortLabel: "Fundo", bar: "bg-funnel-bottom", soft: "bg-funnel-bottom/10", text: "text-funnel-bottom", dot: "bg-funnel-bottom" },
] satisfies StageVisual[];
const UNASSIGNED_STAGE: StageVisual = {
  id: "unassigned",
  label: "Sem etapa",
  shortLabel: "Sem etapa",
  bar: "bg-muted-foreground/40",
  soft: "bg-muted",
  text: "text-muted-foreground",
  dot: "bg-muted-foreground/40",
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

export const currency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

export function mediaPlanBudgetSummary(items: MediaPlanItem[], monthlyBudget: number) {
  const byStage = STAGES.reduce(
    (summary, stage) => {
      const stageItems = items.filter((item) => item.funnel_stage === stage.id);
      summary[stage.id] = {
        pct: stageItems.reduce((total, item) => total + (Number(item.budget_pct) || 0), 0),
        amount: stageItems.reduce((total, item) => total + (Number(item.budget_amount) || 0), 0),
      };
      return summary;
    },
    {} as Record<MediaPlanStage, { pct: number; amount: number }>,
  );
  const allocatedPct = items.reduce((total, item) => total + (Number(item.budget_pct) || 0), 0);
  const allocatedAmount = items.reduce((total, item) => total + (Number(item.budget_amount) || 0), 0);
  return {
    byStage,
    allocatedPct,
    allocatedAmount,
    availablePct: 100 - allocatedPct,
    availableAmount: monthlyBudget - allocatedAmount,
  };
}

function draftFromItem(item?: MediaPlanItem, stage: MediaPlanStage = "topo"): ItemDraft {
  return {
    id: item?.id,
    product_service: item?.product_service ?? "",
    campaign_type: item?.campaign_type ?? "",
    funnel_stage: item?.funnel_stage ?? stage,
    objective: item?.objective ?? "",
    main_kpi: item?.main_kpi ?? "",
    channel: item?.channel ?? "",
    audience: item?.audience ?? "",
    budget_pct: Number(item?.budget_pct) || 0,
    keywords: (item?.keywords ?? []).join(", "),
    benchmark: item?.benchmark ?? "",
    other_refs: item?.other_refs ?? "",
  };
}

export function mediaPlanDraftToPayload(draft: ItemDraft): UpsertItem {
  return {
    id: draft.id,
    product_service: draft.product_service.trim() || null,
    campaign_type: draft.campaign_type || null,
    funnel_stage: draft.funnel_stage,
    objective: draft.objective.trim() || null,
    main_kpi: draft.main_kpi.trim() || null,
    channel: draft.channel || null,
    audience: draft.audience.trim() || null,
    budget_pct: draft.budget_pct,
    keywords: draft.keywords.split(",").map((value) => value.trim()).filter(Boolean),
    benchmark: draft.benchmark.trim() || null,
    other_refs: draft.other_refs.trim() || null,
  };
}

export function MediaPlanEditor({
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
  searchStage: MediaPlanStage | undefined;
  searchChannel: string | undefined;
  onSearch: (patch: { stage?: MediaPlanStage; channel?: string }) => void;
  onUpdatePlan: (patch: { monthly_budget?: number; title?: string }) => void;
  onDeletePlan: () => void;
}) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertMediaPlanItem);
  const deleteFn = useServerFn(deleteMediaPlanItem);
  const reorderFn = useServerFn(reorderMediaPlanItems);
  const [localItems, setLocalItems] = useState(items);
  const [view, setView] = useState<ViewMode>("cards");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<ItemDraft>(() => draftFromItem());
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState(String(plan.monthly_budget));

  useEffect(() => setLocalItems(items), [items]);
  useEffect(() => setBudgetDraft(String(plan.monthly_budget)), [plan.monthly_budget]);

  const summary = useMemo(
    () => mediaPlanBudgetSummary(localItems, Number(plan.monthly_budget) || 0),
    [localItems, plan.monthly_budget],
  );
  const channelsInUse = useMemo(
    () => Array.from(new Set(localItems.map((item) => item.channel).filter(Boolean))) as string[],
    [localItems],
  );
  const filtered = useMemo(
    () =>
      localItems.filter(
        (item) =>
          (!searchStage || item.funnel_stage === searchStage) &&
          (!searchChannel || item.channel === searchChannel),
      ),
    [localItems, searchChannel, searchStage],
  );
  const grouped = useMemo(
    () => {
      const stageGroups = STAGES.map((stage) => ({
        stage,
        items: filtered.filter((item) => item.funnel_stage === stage.id),
      }));
      const unassigned = filtered.filter((item) => !item.funnel_stage);
      return unassigned.length
        ? [...stageGroups, { stage: UNASSIGNED_STAGE, items: unassigned }]
        : stageGroups;
    },
    [filtered],
  );

  const upsertMut = useMutation({
    mutationFn: (item: UpsertItem) => upsertFn({ data: { planId: plan.id, item } }),
    onSuccess: (_, item) => {
      void qc.invalidateQueries({ queryKey: ["media-plan", plan.id] });
      setDrawerOpen(false);
      toast.success(item.id ? "Investimento salvo" : "Investimento adicionado");
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Erro ao salvar investimento"),
  });
  const deleteMut = useMutation({
    mutationFn: (itemId: string) => deleteFn({ data: { itemId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["media-plan", plan.id] });
      toast.success("Investimento excluído");
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Erro ao excluir investimento"),
  });
  const reorderMut = useMutation({
    mutationFn: (orderedIds: string[]) => reorderFn({ data: { planId: plan.id, orderedIds } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["media-plan", plan.id] }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = localItems.findIndex((item) => item.id === event.active.id);
    const newIndex = localItems.findIndex((item) => item.id === event.over?.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(localItems, oldIndex, newIndex);
    setLocalItems(next);
    reorderMut.mutate(next.map((item) => item.id));
  };

  const openNew = (stage: MediaPlanStage = searchStage ?? "topo") => {
    setDraft(draftFromItem(undefined, stage));
    setDrawerOpen(true);
  };
  const openEdit = (item: MediaPlanItem) => {
    setDraft(draftFromItem(item));
    setDrawerOpen(true);
  };
  const deleteItem = (item: MediaPlanItem) => {
    if (confirm(`Excluir o investimento “${item.product_service || "Sem nome"}”?`)) {
      deleteMut.mutate(item.id);
    }
  };
  const saveDraft = () => {
    if (!draft.product_service.trim()) {
      toast.error("Informe o produto ou serviço");
      return;
    }
    if (!draft.channel) {
      toast.error("Selecione o canal");
      return;
    }
    upsertMut.mutate(mediaPlanDraftToPayload(draft));
  };

  const otherPct = summary.allocatedPct - (draft.id ? Number(items.find((item) => item.id === draft.id)?.budget_pct) || 0 : 0);
  const draftAmount = (Number(plan.monthly_budget) * draft.budget_pct) / 100;
  const freeAfterDraft = 100 - otherPct - draft.budget_pct;
  const overBudget = summary.allocatedPct > 100;

  return (
    <div className="space-y-4">
      <section aria-label="Resumo de orçamento" className="space-y-3">
        <PageKpiGrid columns={3}>
          <PageKpi
            label="Orçamento mensal"
            value={currency(plan.monthly_budget)}
            icon={<WalletCards />}
            trailing={editingBudget ? "Editando" : undefined}
            description={
              editingBudget ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Input
                    type="number"
                    min={0}
                    autoFocus
                    className="h-7 w-28"
                    value={budgetDraft}
                    onChange={(event) => setBudgetDraft(event.target.value)}
                  />
                  <Button
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      onUpdatePlan({ monthly_budget: Number(budgetDraft) || 0 });
                      setEditingBudget(false);
                    }}
                  >
                    Salvar
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingBudget(false)}>
                    Cancelar
                  </Button>
                </span>
              ) : (
                <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setEditingBudget(true)}>
                  Editar orçamento
                </Button>
              )
            }
          />
          <PageKpi
            label="Alocado"
            value={currency(summary.allocatedAmount)}
            status={overBudget ? "danger" : "info"}
            description={`${summary.allocatedPct.toFixed(1)}% do orçamento`}
          />
          <PageKpi
            label="Disponível"
            value={currency(summary.availableAmount)}
            status={summary.availableAmount < 0 ? "danger" : "success"}
            description={summary.availablePct < 0 ? `${Math.abs(summary.availablePct).toFixed(1)}% excedido` : `${summary.availablePct.toFixed(1)}% livre`}
          />
        </PageKpiGrid>
        <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {STAGES.map((stage) => (
              <span key={stage.id} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-sm", stage.dot)} />
                {stage.shortLabel} {summary.byStage[stage.id].pct.toFixed(1)}%
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-muted-foreground/25" />
              Livre {Math.max(0, summary.availablePct).toFixed(1)}%
            </span>
          </div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
            {STAGES.map((stage) => (
              <span
                key={stage.id}
                className={cn("h-full transition-[width]", stage.bar)}
                style={{ width: `${Math.min(100, Math.max(0, summary.byStage[stage.id].pct))}%` }}
              />
            ))}
          </div>
          {overBudget ? (
            <p className="mt-2 text-xs text-destructive">A alocação excede o orçamento em {(summary.allocatedPct - 100).toFixed(1)}%.</p>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={searchStage ?? "all"} onValueChange={(value) => onSearch({ stage: value === "all" ? undefined : (value as MediaPlanStage) })}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as etapas</SelectItem>
            {STAGES.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={searchChannel ?? "all"} onValueChange={(value) => onSearch({ channel: value === "all" ? undefined : value })}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os canais</SelectItem>
            {channelsInUse.map((channel) => <SelectItem key={channel} value={channel}>{channel}</SelectItem>)}
          </SelectContent>
        </Select>
        {(searchStage || searchChannel) ? (
          <Button variant="ghost" size="sm" onClick={() => onSearch({ stage: undefined, channel: undefined })}>Limpar filtros</Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md bg-muted p-0.5" aria-label="Modo de visualização">
            <Button variant={view === "cards" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setView("cards")} aria-pressed={view === "cards"}>
              <LayoutGrid className="h-4 w-4" /> Cartões
            </Button>
            <Button variant={view === "sheet" ? "secondary" : "ghost"} size="sm" className="h-8" onClick={() => setView("sheet")} aria-pressed={view === "sheet"}>
              <List className="h-4 w-4" /> Planilha
            </Button>
          </div>
          <Button size="sm" className="h-9" onClick={() => openNew()}>
            <Plus className="h-4 w-4" /> Adicionar linha
          </Button>
          <Button size="sm" variant="ghost" className="h-9 text-destructive hover:text-destructive" onClick={onDeletePlan}>
            <Trash2 className="h-4 w-4" /> Excluir plano
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={filtered.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          {view === "cards" ? (
            <div className="space-y-6">
              {grouped.map(({ stage, items: stageItems }) => (
                <StageCards
                  key={stage.id}
                  stage={stage}
                  items={stageItems}
                  subtotal={
                    stage.id === "unassigned"
                      ? {
                          pct: stageItems.reduce((total, item) => total + Number(item.budget_pct || 0), 0),
                          amount: stageItems.reduce((total, item) => total + Number(item.budget_amount || 0), 0),
                        }
                      : summary.byStage[stage.id]
                  }
                  onEdit={openEdit}
                  onDelete={deleteItem}
                  onAdd={stage.id === "unassigned" ? undefined : () => openNew(stage.id as MediaPlanStage)}
                />
              ))}
            </div>
          ) : (
            <MediaPlanSheet
              groups={grouped}
              summary={summary}
              onEdit={openEdit}
              onDelete={deleteItem}
            />
          )}
        </SortableContext>
      </DndContext>

      <InvestmentSheet
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        draft={draft}
        setDraft={setDraft}
        monthlyBudget={plan.monthly_budget}
        draftAmount={draftAmount}
        freeAfterDraft={freeAfterDraft}
        pending={upsertMut.isPending}
        onSave={saveDraft}
      />
    </div>
  );
}

function SortableHandle({
  attributes,
  listeners,
}: {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
}) {
  return (
    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 cursor-grab text-muted-foreground" title="Reordenar" {...attributes} {...listeners}>
      <GripVertical className="h-4 w-4" />
    </Button>
  );
}

function StageCards({
  stage,
  items,
  subtotal,
  onEdit,
  onDelete,
  onAdd,
}: {
  stage: StageVisual;
  items: MediaPlanItem[];
  subtotal: { pct: number; amount: number };
  onEdit: (item: MediaPlanItem) => void;
  onDelete: (item: MediaPlanItem) => void;
  onAdd?: () => void;
}) {
  return (
    <section aria-labelledby={`stage-${stage.id}`}>
      <div className="mb-2.5 flex items-center gap-2 px-0.5">
        <span className={cn("h-2.5 w-2.5 rounded-sm", stage.dot)} />
        <h2 id={`stage-${stage.id}`} className={cn("text-xs font-semibold uppercase tracking-wider", stage.text)}>{stage.label}</h2>
        <span className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "investimento" : "investimentos"}</span>
        <span className="ml-auto text-sm font-semibold tabular-nums">{currency(subtotal.amount)} <span className="font-normal text-muted-foreground">· {subtotal.pct.toFixed(1)}%</span></span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map((item) => (
          <InvestmentCard key={item.id} item={item} stage={stage} onEdit={onEdit} onDelete={onDelete} />
        ))}
        {onAdd ? (
          <Button variant="outline" className="min-h-24 border-dashed text-muted-foreground" onClick={onAdd}>
            <Plus className="h-4 w-4" /> Adicionar investimento
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function InvestmentCard({ item, stage, onEdit, onDelete }: { item: MediaPlanItem; stage: StageVisual; onEdit: (item: MediaPlanItem) => void; onDelete: (item: MediaPlanItem) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <article ref={setNodeRef} style={style} className="relative overflow-hidden rounded-lg border border-border/60 bg-card p-4 pl-5 transition-colors hover:border-foreground/20">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", stage.bar)} />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{item.product_service || "Sem produto/serviço"}</h3>
          <Badge variant="secondary" className="mt-1.5 gap-1.5 rounded-full font-medium">
            <span className={cn("h-1.5 w-1.5 rounded-full", stage.dot)} />{item.channel || "Sem canal"}
          </Badge>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-lg font-semibold tabular-nums">{currency(item.budget_amount)}</div>
          <div className={cn("text-xs font-semibold tabular-nums", stage.text)}>{Number(item.budget_pct).toFixed(1)}%</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.campaign_type ? <Badge variant="outline">{item.campaign_type}</Badge> : null}
        <Badge variant="outline" className={cn("border-transparent", stage.soft, stage.text)}>{stage.shortLabel}</Badge>
        {item.objective ? <Badge variant="outline">Objetivo: {item.objective}</Badge> : null}
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto] items-end gap-3 border-t border-border/50 pt-3">
        <CardMeta label="KPI" value={item.main_kpi} />
        <CardMeta label="Público" value={item.audience} />
        <div className="flex items-center gap-0.5">
          <SortableHandle attributes={attributes} listeners={listeners} />
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar investimento" onClick={() => onEdit(item)}><Pencil className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Excluir investimento" onClick={() => onDelete(item)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
    </article>
  );
}

function CardMeta({ label, value }: { label: string; value: string | null }) {
  return <div className="min-w-0"><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><div className="truncate text-xs font-medium" title={value ?? undefined}>{value || "—"}</div></div>;
}

function MediaPlanSheet({ groups, summary, onEdit, onDelete }: { groups: Array<{ stage: StageVisual; items: MediaPlanItem[] }>; summary: ReturnType<typeof mediaPlanBudgetSummary>; onEdit: (item: MediaPlanItem) => void; onDelete: (item: MediaPlanItem) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
      <div className="min-w-[980px]">
        <div className="grid grid-cols-[minmax(210px,1.5fr)_120px_130px_150px_130px_minmax(170px,1fr)_80px_110px_92px] border-b border-border/60 bg-muted/40 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {['Produto / serviço','Canal','Campanha','Objetivo','KPI','Público','%','R$','Ações'].map((label, index) => <div key={label} className={cn("px-3 py-3", index === 0 && "sticky left-0 z-10 bg-muted", index === 6 || index === 7 ? "text-right" : "")}>{label}</div>)}
        </div>
        {groups.map(({ stage, items }) => (
          <div key={stage.id}>
            <div className="grid grid-cols-[minmax(210px,1.5fr)_120px_130px_150px_130px_minmax(170px,1fr)_80px_110px_92px] border-b border-border/60 bg-muted/25 text-xs font-semibold">
              <div className="sticky left-0 z-10 col-span-6 flex items-center gap-2 bg-muted px-3 py-2"><span className={cn("h-2 w-2 rounded-sm", stage.dot)} /><span className={stage.text}>{stage.label}</span><span className="font-normal text-muted-foreground">{items.length}</span></div>
              <div className="px-3 py-2 text-right tabular-nums">{(stage.id === "unassigned" ? items.reduce((total, item) => total + Number(item.budget_pct || 0), 0) : summary.byStage[stage.id].pct).toFixed(1)}%</div>
              <div className="px-3 py-2 text-right tabular-nums">{currency(stage.id === "unassigned" ? items.reduce((total, item) => total + Number(item.budget_amount || 0), 0) : summary.byStage[stage.id].amount)}</div><div />
            </div>
            {items.map((item) => <SheetRow key={item.id} item={item} onEdit={onEdit} onDelete={onDelete} />)}
          </div>
        ))}
        <div className="grid grid-cols-[minmax(210px,1.5fr)_120px_130px_150px_130px_minmax(170px,1fr)_80px_110px_92px] bg-muted/40 text-sm font-semibold">
          <div className="sticky left-0 z-10 col-span-6 bg-muted px-3 py-3">Total alocado</div>
          <div className="px-3 py-3 text-right tabular-nums">{summary.allocatedPct.toFixed(1)}%</div>
          <div className="px-3 py-3 text-right tabular-nums">{currency(summary.allocatedAmount)}</div><div />
        </div>
      </div>
    </div>
  );
}

function SheetRow({ item, onEdit, onDelete }: { item: MediaPlanItem; onEdit: (item: MediaPlanItem) => void; onDelete: (item: MediaPlanItem) => void }) {
  const [open, setOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <Collapsible open={open} onOpenChange={setOpen} ref={setNodeRef} style={style} className="border-b border-border/40 last:border-b-0">
      <div className="grid grid-cols-[minmax(210px,1.5fr)_120px_130px_150px_130px_minmax(170px,1fr)_80px_110px_92px] items-center text-xs hover:bg-muted/20">
        <div className="sticky left-0 z-10 flex min-w-0 items-center gap-1 bg-card px-2 py-2.5 font-semibold">
          <CollapsibleTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Expandir referências">{open ? <ChevronDown /> : <ChevronRight />}</Button></CollapsibleTrigger>
          <span className="truncate">{item.product_service || "Sem produto/serviço"}</span>
        </div>
        <Cell>{item.channel || "—"}</Cell><Cell>{item.campaign_type || "—"}</Cell><Cell>{item.objective || "—"}</Cell><Cell>{item.main_kpi || "—"}</Cell><Cell>{item.audience || "—"}</Cell>
        <Cell right>{Number(item.budget_pct).toFixed(1)}%</Cell><Cell right>{currency(item.budget_amount)}</Cell>
        <div className="flex justify-end gap-0.5 px-2"><SortableHandle attributes={attributes} listeners={listeners} /><Button variant="ghost" size="icon" className="h-8 w-8" title="Editar investimento" onClick={() => onEdit(item)}><Pencil /></Button><Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Excluir investimento" onClick={() => onDelete(item)}><Trash2 /></Button></div>
      </div>
      <CollapsibleContent className="bg-muted/15 px-4 py-3">
        <div className="grid gap-4 pl-7 sm:grid-cols-3"><Detail label="Palavras-chave" value={(item.keywords ?? []).join(", ")} /><Detail label="Benchmark" value={item.benchmark} /><Detail label="Outras referências" value={item.other_refs} /></div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Cell({ children, right }: { children: React.ReactNode; right?: boolean }) { return <div className={cn("truncate px-3 py-2.5", right && "text-right tabular-nums")}>{children}</div>; }
function Detail({ label, value }: { label: string; value: string | null }) { return <div><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div><p className="mt-1 text-xs">{value || "—"}</p></div>; }

function InvestmentSheet({ open, onOpenChange, draft, setDraft, monthlyBudget, draftAmount, freeAfterDraft, pending, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; draft: ItemDraft; setDraft: React.Dispatch<React.SetStateAction<ItemDraft>>; monthlyBudget: number; draftAmount: number; freeAfterDraft: number; pending: boolean; onSave: () => void }) {
  const update = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const stage = STAGES.find((entry) => entry.id === draft.funnel_stage) ?? STAGES[0];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border/60 p-5 pr-12">
          <div className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-sm", stage.dot)} /><SheetTitle>{draft.id ? "Editar investimento" : "Novo investimento"}</SheetTitle></div>
          <SheetDescription>{draft.id ? `${stage.label} · ${draft.product_service || "Sem nome"}` : "Adicione uma nova linha ao plano de mídia."}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-5">
          <FormSection title="Identificação">
            <Field label="Produto / serviço"><Input value={draft.product_service} onChange={(event) => update("product_service", event.target.value)} placeholder="Produto ou serviço" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Tipo de campanha"><OptionSelect value={draft.campaign_type} placeholder="Selecionar" options={CAMPAIGN_TYPES} onChange={(value) => update("campaign_type", value)} /></Field>
              <Field label="Canal"><OptionSelect value={draft.channel} placeholder="Selecionar" options={CHANNEL_OPTIONS} onChange={(value) => update("channel", value)} /></Field>
            </div>
            <Field label="Etapa do funil">
              <div className="grid grid-cols-3 gap-2">{STAGES.map((entry) => <Button key={entry.id} type="button" variant="outline" className={cn("h-10", draft.funnel_stage === entry.id && cn(entry.soft, entry.text, "border-transparent"))} onClick={() => update("funnel_stage", entry.id)}><span className={cn("h-2 w-2 rounded-full", entry.dot)} />{entry.shortLabel}</Button>)}</div>
            </Field>
          </FormSection>
          <FormSection title="Objetivo e meta">
            <Field label="Objetivo"><Input value={draft.objective} onChange={(event) => update("objective", event.target.value)} placeholder="Ex.: Leads" /></Field>
            <Field label="KPI"><Input value={draft.main_kpi} onChange={(event) => update("main_kpi", event.target.value)} placeholder="Ex.: CPL R$ 8" /></Field>
          </FormSection>
          <FormSection title="Investimento">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="% do orçamento"><Input type="number" min={0} max={1000} step={0.5} value={draft.budget_pct} onChange={(event) => update("budget_pct", Number(event.target.value) || 0)} /></Field>
                <Field label="Valor (R$)"><Input readOnly value={currency(draftAmount)} /></Field>
              </div>
              <p className={cn("mt-2 text-xs", freeAfterDraft < 0 ? "text-destructive" : "text-muted-foreground")}><strong className="font-semibold text-foreground">{currency(draftAmount)}</strong> de {currency(monthlyBudget)} · {freeAfterDraft < 0 ? `excede em ${Math.abs(freeAfterDraft).toFixed(1)}%` : `restam ${freeAfterDraft.toFixed(1)}% livres`}</p>
            </div>
          </FormSection>
          <FormSection title="Segmentação e referências">
            <Field label="Público"><Input value={draft.audience} onChange={(event) => update("audience", event.target.value)} placeholder="Público da campanha" /></Field>
            <Field label="Palavras-chave"><Textarea value={draft.keywords} onChange={(event) => update("keywords", event.target.value)} placeholder="Separe por vírgulas" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Benchmark"><Input value={draft.benchmark} onChange={(event) => update("benchmark", event.target.value)} placeholder="Ex.: CTR 1,4%" /></Field>
              <Field label="Outras referências"><Input value={draft.other_refs} onChange={(event) => update("other_refs", event.target.value)} placeholder="Links ou referências" /></Field>
            </div>
          </FormSection>
        </div>
        <SheetFooter className="border-t border-border/60 p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSave} disabled={pending}>{pending ? "Salvando…" : "Salvar investimento"}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mb-6 space-y-3 last:mb-0"><div className="flex items-center gap-2"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3><span className="h-px flex-1 bg-border/60" /></div>{children}</section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block space-y-1.5 text-xs font-medium text-muted-foreground"><span>{label}</span>{children}</label>; }
function OptionSelect({ value, placeholder, options, onChange }: { value: string; placeholder: string; options: string[]; onChange: (value: string) => void }) { return <Select value={value || undefined} onValueChange={onChange}><SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>; }
