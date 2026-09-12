import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  Plus,
  Rocket,
  Share2,
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
import { DashboardPageShell } from "@/components/ui/dashboard-primitives";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import {
  createMediaPlan,
  deleteMediaPlan,
  getMediaPlan,
  issueMediaPlanShareToken,
  listMediaPlans,
  revokeMediaPlanShareToken,
  updateMediaPlan,
  type MediaPlan,
} from "@/lib/media-plans.functions";
import { PlanStrategyPanel } from "@/components/media-plans/plan-strategy-panel";
import { MediaPlanEditor } from "@/components/media-plans/media-plan-editor";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";

type MediaPlanSearch = {
  planId?: string;
  stage?: "topo" | "meio" | "fundo";
  channel?: string;
};
// Tolerante por campo: link antigo ou parâmetro inesperado nunca derruba a tela.
const searchSchema = z
  .object({
    planId: z.string().uuid().optional().catch(undefined),
    stage: z.enum(["topo", "meio", "fundo"]).optional().catch(undefined),
    channel: z.string().optional().catch(undefined),
  })
  .catch({});

export const Route = createFileRoute("/_authenticated/customers/$customerId/media-plan")({
  head: () => ({
    meta: [
      { title: "Plano de mídia | Unitos" },
      {
        name: "description",
        content: "Planeje investimentos, canais, públicos e metas de mídia paga por etapa do funil.",
      },
      { property: "og:title", content: "Plano de mídia | Unitos" },
      {
        property: "og:description",
        content: "Planeje investimentos, canais, públicos e metas de mídia paga por etapa do funil.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => ensureFeatureEnabled("midia_paga"),
  validateSearch: (raw: Record<string, unknown>): MediaPlanSearch => searchSchema.parse(raw),
  component: MediaPlanPage,
  pendingComponent: () => (
    <DashboardPageShell>
      <Skeleton className="h-96 w-full" />
    </DashboardPageShell>
  ),
  errorComponent: MediaPlanRouteError,
  notFoundComponent: () => <MediaPlanRouteError />,
});

/** Nunca deixar tela branca: erro com motivo e caminhos de saída. */
function MediaPlanRouteError({ error, reset }: { error?: Error; reset?: () => void }) {
  const router = useRouter();
  return (
    <DashboardPageShell>
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/40 px-6 py-16 text-center">
        <AlertTriangle className="mb-4 h-10 w-10 text-amber-500" />
        <div className="mb-1 text-lg font-medium">Não foi possível abrir o plano de mídia</div>
        <div className="mb-6 max-w-md text-sm text-muted-foreground">
          {error?.message?.trim() || "Tente novamente em alguns instantes."}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              void router.invalidate();
              reset?.();
            }}
          >
            Tentar novamente
          </Button>
          <Button
            variant="outline"
            onClick={() => void router.navigate({ to: "/media-plans", search: { tab: "planos" } })}
          >
            Voltar para Mídia paga
          </Button>
        </div>
      </div>
    </DashboardPageShell>
  );
}

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
      ) : plansQ.isError ? (
        <PlanLoadError
          message={
            plansQ.error instanceof Error ? plansQ.error.message : "Falha ao carregar os planos."
          }
          onRetry={() => void plansQ.refetch()}
        />
      ) : plans.length === 0 ? (
        <EmptyState onCreate={() => setCreating(true)} />
      ) : planQ.isError ? (
        <PlanLoadError
          message={
            planQ.error instanceof Error ? planQ.error.message : "Falha ao carregar este plano."
          }
          onRetry={() => void planQ.refetch()}
        />
      ) : !!search.planId && !plansQ.isFetching && !plans.some((p) => p.id === search.planId) ? (
        <PlanMissing
          onOpenLatest={() =>
            navigate({
              to: ".",
              search: (p: MediaPlanSearch) => ({ ...p, planId: undefined }),
              replace: true,
            })
          }
        />
      ) : !activePlanId || !planQ.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-4">
          <PlanStrategyPanel plan={planQ.data.plan} items={planQ.data.items} />
          <MediaPlanEditor
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
        </div>
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

function PlanLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/40 px-6 py-16 text-center">
      <AlertTriangle className="mb-4 h-10 w-10 text-amber-500" />
      <div className="mb-1 text-lg font-medium">Não foi possível carregar</div>
      <div className="mb-6 max-w-md text-sm text-muted-foreground">{message}</div>
      <Button onClick={onRetry}>Tentar novamente</Button>
    </div>
  );
}

function PlanMissing({ onOpenLatest }: { onOpenLatest: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/40 px-6 py-16 text-center">
      <AlertTriangle className="mb-4 h-10 w-10 text-amber-500" />
      <div className="mb-1 text-lg font-medium">Este plano não está mais disponível</div>
      <div className="mb-6 max-w-md text-sm text-muted-foreground">
        Ele pode ter sido excluído. Abra o plano mais recente deste cliente.
      </div>
      <Button onClick={onOpenLatest}>Abrir plano mais recente</Button>
    </div>
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

