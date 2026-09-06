import { useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  FolderKanban,
  Link as LinkIcon,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { describeError } from "@/lib/errors";
import {
  GeneratePlanWizard,
  type GenerateSelection,
  type OverageItem,
} from "@/components/monthly-plan/generate-plan-wizard";
import { requestPlanOverageFn } from "@/lib/plan-overage.functions";
import { VolumetryCards, type PlanVolumetry } from "@/components/monthly-plan/volumetry-cards";
import { ContextSourcesRow } from "@/components/monthly-plan/context-sources-row";
import { PautaBoard } from "@/components/monthly-plan/pauta-board";
import {
  LinkPautaProjectDialog,
  NewPautaDialog,
} from "@/components/monthly-plan/new-pauta-dialog";
import { PLAN_CHANNELS, PLAN_CHANNEL_LABEL as CHANNEL_LABEL } from "@/lib/monthly-plan-fields";
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABEL,
  normalizeContentFormat,
} from "@/lib/content-formats";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describePlanDeleteError } from "@/components/monthly-plan/pauta-board";
import {
  approveMonthlyPlanFn,
  canDeletePlansFn,
  createTopicFn,
  deleteMonthlyPlanFn,
  deleteTopicFn,
  discardMonthlyPlanFn,
  generateMonthlyPlanFn,
  getMonthlyPlanFn,
  getPlanClientLinkFn,
  getPlanVolumetryFn,
  listBriefingsForPlanFn,
  regenerateTopicFn,
  setTopicDecisionFn,
  submitPlanToClientFn,
  undoTopicRegenerationFn,
  updateMonthlyPlanFn,
  updateTopicFn,
  type GenerateMonthlyPlanResult,
  type MonthlyPlanTopic,
  type MonthlyPlanWithTopics,
  type PlanOrganizationInput,
} from "@/lib/monthly-plans.functions";

/* --------------------------------------------------------------- */

const LOADING_MESSAGES = [
  "Analisando briefing…",
  "Mapeando ganchos estratégicos…",
  "Balanceando formatos de conteúdo…",
  "Escrevendo títulos com personalidade…",
  "Alinhando com o tom de voz da marca…",
  "Finalizando a pauta…",
];

/**
 * Shell da pauta. Quando embutida no Painel do Cliente o padding externo já
 * existe — repeti-lo criava margens duplas (visível no mobile).
 */
function PlanShell({
  embedded,
  className,
  children,
}: {
  embedded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-full space-y-6",
        embedded ? "px-0 py-0" : "px-4 py-6 sm:px-6 lg:px-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MonthlyPlanView({
  brandId,
  clientId,
  planId: planIdProp,
  onSelectPlan,
  embedded = false,
}: {
  brandId: string;
  clientId: string;
  planId?: string | null;
  onSelectPlan?: (id: string | null) => void;
  /** true quando a pauta é renderizada dentro do Painel do Cliente (que já tem padding). */
  embedded?: boolean;
}) {
  // Route-agnostic: this view is mounted from both
  // /_authenticated/customers/$customerId/pauta and /_authenticated/monthly-plan/*
  const rawSearch = useSearch({ strict: false }) as { planId?: string };
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const planId = onSelectPlan ? (planIdProp ?? null) : (rawSearch.planId ?? null);
  const setPlanId = (id: string | null) => {
    if (onSelectPlan) {
      onSelectPlan(id);
      return;
    }
    navigate({
      to: pathname,
      search: id ? { planId: id } : {},
      replace: true,
    });
  };

  const [theme, setTheme] = useState("");
  const [briefingId, setBriefingId] = useState<string>("__none");

  const listBriefings = useServerFn(listBriefingsForPlanFn);
  const briefingsQ = useQuery({
    queryKey: ["monthly-plan", "briefings", brandId, clientId],
    queryFn: () => listBriefings({ data: { brandId, clientId } }),
  });

  const getVolumetry = useServerFn(getPlanVolumetryFn);
  const volumetryQ = useQuery({
    queryKey: ["monthly-plan", "volumetry", brandId, clientId],
    queryFn: () => getVolumetry({ data: { brandId, clientId } }),
  });
  const volumetry = volumetryQ.data as PlanVolumetry | undefined;
  const hasVolumetry = (volumetry?.totalTarget ?? 0) > 0;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [newPautaOpen, setNewPautaOpen] = useState(false);

  const requestOverage = useServerFn(requestPlanOverageFn);
  const overageM = useMutation({
    mutationFn: (input: { items: OverageItem[]; justification: string }) =>
      requestOverage({
        data: {
          brandId,
          clientId,
          justification: input.justification,
          items: input.items.map((it) => ({
            channel: it.channel,
            quota: it.quota,
            requested: it.requested,
            overage: it.overage,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Solicitação de excedente enviada ao gestor da conta.");
      setWizardOpen(false);
    },
    onError: (err) => toast.error(describeError(err)),
  });

  const generate = useServerFn(generateMonthlyPlanFn);
  const [loadingStep, setLoadingStep] = useState(0);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const generateM = useMutation({
    mutationFn: (input: {
      theme: string;
      briefingId: string | null;
      selection: GenerateSelection[];
      organization: PlanOrganizationInput;
    }) =>
      generate({
        data: {
          brandId,
          clientId,
          theme: input.theme,
          briefingId: input.briefingId ?? undefined,
          selection: input.selection.length ? input.selection : undefined,
          organization: input.organization,
        },
      }),
    onMutate: () => {
      setGenerationError(null);
      setLoadingStep(0);
      stepTimer.current = setInterval(() => {
        setLoadingStep((s) => (s + 1) % LOADING_MESSAGES.length);
      }, 1800);
    },
    onSettled: () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
      stepTimer.current = null;
    },
    onSuccess: (result: GenerateMonthlyPlanResult) => {
      if (!result.ok) {
        if (result.code === "overage_not_authorized") {
          const msg = describeError("overage_not_authorized");
          setGenerationError(msg);
          toast.error(msg);
          return;
        }
        const msg = describeError(result.code);
        setGenerationError(msg);
        toast.error(`Não foi possível gerar a pauta: ${msg}`, {
          action: { label: "Abrir Conexões", onClick: () => navigate({ to: "/connections" }) },
        });
        return;
      }
      const res = result.data;
      qc.setQueryData(["monthly-plan", res.plan.id], res);
      qc.invalidateQueries({ queryKey: ["monthly-plans", "list", brandId, clientId] });
      setGenerationError(null);
      setWizardOpen(false);
      setPlanId(res.plan.id);
    },

    onError: (err) => {
      const msg = describeError(err);
      const isAiConfig = /IA configurada|chave|provedor/i.test(msg);
      toast.error(`Falha ao gerar pauta: ${msg}`, {
        action: isAiConfig
          ? { label: "Abrir Conexões", onClick: () => navigate({ to: "/connections" }) }
          : undefined,
      });
      setGenerationError(msg);
    },
  });

  const qc = useQueryClient();

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, []);

  /* -------- ESTADO 1: geração -------- */
  if (!planId) {
    return (
      <PlanShell embedded={embedded}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 sm:flex sm:flex-wrap sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Volumetria e geração do mês</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              O briefing do cliente é sempre usado como contexto. Escolha canais, quantidades e
              formatos no assistente de geração.
            </p>
          </div>
          <Button
            variant="ai"
            className="h-10 gap-2"
            disabled={!hasVolumetry || volumetryQ.isLoading}
            onClick={() => setWizardOpen(true)}
          >
            <Sparkles className="h-4 w-4" />
            Gerar pauta com IA
          </Button>
        </div>

        <VolumetryCards volumetry={volumetry} loading={volumetryQ.isLoading} />

        <PautaBoard
          brandId={brandId}
          clientId={clientId}
          onOpen={(id) => setPlanId(id)}
          onNewPauta={() => setNewPautaOpen(true)}
        />

        <NewPautaDialog
          open={newPautaOpen}
          onOpenChange={setNewPautaOpen}
          brandId={brandId}
          clientId={clientId}
          onCreated={(id) => setPlanId(id)}
        />

        <GeneratePlanWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          brandId={brandId}
          clientId={clientId}
          volumetry={volumetry}
          briefings={briefingsQ.data ?? []}
          pending={generateM.isPending}
          loadingMessage={LOADING_MESSAGES[loadingStep] ?? LOADING_MESSAGES[0]!}
          generationError={generationError}
          onGenerate={(input) => generateM.mutate(input)}
          requestingOverage={overageM.isPending}
          onRequestOverage={(items, justification) => overageM.mutate({ items, justification })}
        />
      </PlanShell>
    );
  }

  /* -------- ESTADO 2: aprovação -------- */
  return (
    <ApprovalView
      planId={planId}
      brandId={brandId}
      clientId={clientId}
      embedded={embedded}
      onBack={() => {
        setWizardOpen(false);
        setPlanId(null);
      }}
      onDiscarded={() => {
        setWizardOpen(false);
        setPlanId(null);
        setTheme("");
        setBriefingId("__none");
        qc.invalidateQueries({ queryKey: ["monthly-plans", "list", brandId, clientId] });
      }}
    />
  );
}

// Metadados de status vivem em @/lib/monthly-plan-status (compartilhados com Projetos).

function ApprovalView({
  planId,
  brandId,
  clientId,
  onBack,
  onDiscarded,
  embedded = false,
}: {
  planId: string;
  brandId: string;
  clientId: string;
  onBack: () => void;
  onDiscarded: () => void;
  embedded?: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const getPlan = useServerFn(getMonthlyPlanFn);
  const updatePlan = useServerFn(updateMonthlyPlanFn);
  const createTopic = useServerFn(createTopicFn);
  const updateTopic = useServerFn(updateTopicFn);
  const deleteTopic = useServerFn(deleteTopicFn);
  const approvePlan = useServerFn(approveMonthlyPlanFn);
  const discardPlan = useServerFn(discardMonthlyPlanFn);
  const setDecision = useServerFn(setTopicDecisionFn);
  const regenerate = useServerFn(regenerateTopicFn);
  const undoRegen = useServerFn(undoTopicRegenerationFn);
  const submitToClient = useServerFn(submitPlanToClientFn);
  const getLink = useServerFn(getPlanClientLinkFn);
  const deletePlan = useServerFn(deleteMonthlyPlanFn);
  const canDeleteAuthority = useServerFn(canDeletePlansFn);

  const q = useQuery({
    queryKey: ["monthly-plan", planId],
    queryFn: () => getPlan({ data: { planId } }),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["monthly-plan", planId] });
    void qc.invalidateQueries({ queryKey: ["monthly-plans", "list", brandId, clientId] });
  };

  const savePlan = useMutation({
    mutationFn: (patch: { title?: string; description?: string; objectives?: string }) =>
      updatePlan({ data: { planId, ...patch } }),
    onError: (e) => toast.error(`Falha ao salvar: ${describeError(e)}`),
  });

  const addTopic = useMutation({
    mutationFn: () =>
      createTopic({
        data: {
          planId,
          topic_title: "Nova ideia de post",
          content_format: null,
          channel: null,
          angle: "",
        },
      }),
    onSuccess: (t) => {
      qc.setQueryData<MonthlyPlanWithTopics | null>(["monthly-plan", planId], (prev) =>
        prev ? { ...prev, topics: [...prev.topics, t] } : prev,
      );
    },
    onError: (e) => toast.error(`Falha ao adicionar tópico: ${describeError(e)}`),
  });

  const patchTopic = useMutation({
    mutationFn: (input: { topicId: string; patch: Partial<MonthlyPlanTopic> }) =>
      updateTopic({
        data: {
          topicId: input.topicId,
          topic_title: input.patch.topic_title,
          content_format: input.patch.content_format ?? undefined,
          channel: input.patch.channel ?? undefined,
          angle: input.patch.angle ?? undefined,
        },
      }),
    onError: (e) => toast.error(`Falha ao atualizar tópico: ${describeError(e)}`),
  });

  const topicDecision = useMutation({
    mutationFn: (input: { topicId: string; status: "pending" | "approved" | "rejected" }) =>
      setDecision({ data: input }),
    onMutate: (input) => {
      qc.setQueryData<MonthlyPlanWithTopics | null>(["monthly-plan", planId], (p) =>
        p
          ? {
              ...p,
              topics: p.topics.map((t) =>
                t.id === input.topicId ? { ...t, status: input.status } : t,
              ),
            }
          : p,
      );
    },
    onError: (e) => {
      invalidate();
      toast.error(
        describeError(e).includes("topic_incomplete")
          ? "Defina plataforma e formato antes de aprovar."
          : `Falha ao decidir: ${describeError(e)}`,
      );
    },
  });

  const approveAll = useMutation({
    mutationFn: async (ids: string[]) => {
      let ok = 0;
      const failed: string[] = [];
      for (const topicId of ids) {
        try {
          await setDecision({ data: { topicId, status: "approved" as const } });
          ok += 1;
        } catch {
          failed.push(topicId);
        }
      }
      return { ok, failed: failed.length };
    },
    onSuccess: ({ ok, failed }) => {
      invalidate();
      if (ok > 0) toast.success(`${ok} ${ok === 1 ? "item aprovado" : "itens aprovados"}.`);
      if (failed > 0)
        toast.warning(
          `${failed} ${failed === 1 ? "item ficou" : "itens ficaram"} sem aprovar — defina plataforma e formato.`,
        );
    },
    onError: (e) => {
      invalidate();
      toast.error(`Falha ao aprovar todos: ${describeError(e)}`);
    },
  });

  const regenM = useMutation({
    mutationFn: (input: { topicId: string; instruction: string }) => regenerate({ data: input }),
    onSuccess: (t) => {
      qc.setQueryData<MonthlyPlanWithTopics | null>(["monthly-plan", planId], (p) =>
        p ? { ...p, topics: p.topics.map((x) => (x.id === t.id ? t : x)) } : p,
      );
      toast.success("Item regenerado.");
    },
    onError: (e) => toast.error(`Falha ao regenerar: ${describeError(e)}`),
  });

  const undoM = useMutation({
    mutationFn: (topicId: string) => undoRegen({ data: { topicId } }),
    onSuccess: (t) => {
      qc.setQueryData<MonthlyPlanWithTopics | null>(["monthly-plan", planId], (p) =>
        p ? { ...p, topics: p.topics.map((x) => (x.id === t.id ? t : x)) } : p,
      );
    },
    onError: (e) => toast.error(`Falha ao desfazer: ${describeError(e)}`),
  });

  const removeTopic = useMutation({
    mutationFn: (topicId: string) => deleteTopic({ data: { topicId } }),
    onMutate: (topicId) => {
      const prev = qc.getQueryData<MonthlyPlanWithTopics | null>(["monthly-plan", planId]);
      qc.setQueryData<MonthlyPlanWithTopics | null>(["monthly-plan", planId], (p) =>
        p ? { ...p, topics: p.topics.filter((t) => t.id !== topicId) } : p,
      );
      return { prev };
    },
    onError: (e, _, ctx) => {
      if (ctx?.prev) qc.setQueryData(["monthly-plan", planId], ctx.prev);
      toast.error(`Falha ao remover: ${describeError(e)}`);
    },
  });

  const submitM = useMutation({
    mutationFn: async () => {
      // Pauta antiga sem projeto: pede a escolha antes de gerar o link.
      if (!q.data?.plan.project_id) throw new Error("project_required");
      return submitToClient({ data: { planId } });
    },
    onSuccess: (link) => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ["monthly-plan-link", planId] });
      // Cliente que não aprova pauta: seguiu direto para produção.
      if (link.waived || !link.url) {
        toast.success("Pauta liberada para produção.", {
          description: `Este cliente não aprova pauta.${
            link.cardsCreated ? ` ${link.cardsCreated} card(s) criado(s) no Kanban.` : ""
          }`,
        });
        return;
      }
      toast.success("Pauta enviada para aprovação do cliente.", {
        description: "Copie o link de aprovação e envie ao cliente.",
      });
      void navigator.clipboard?.writeText(`${window.location.origin}${link.url}`).catch(() => {});
    },

    onError: (e) => {
      const m = describeError(e);
      if (m.includes("project_required")) {
        setProjectDialogReason("submit");
        setProjectDialogOpen(true);
        toast.error("Escolha o projeto desta pauta antes de enviar ao cliente.");
        return;
      }
      toast.error(
        m.includes("topics_pending_decision")
          ? "Ainda há itens sem decisão interna (aprovar ou descartar)."
          : m.includes("topics_incomplete")
            ? "Há itens aprovados sem plataforma ou formato."
            : m.includes("no_approved_topics")
              ? "Aprove ao menos um item antes de enviar ao cliente."
              : `Falha ao enviar: ${m}`,
      );
    },
  });

  const linkQ = useQuery({
    queryKey: ["monthly-plan-link", planId],
    queryFn: () => getLink({ data: { planId } }),
    enabled: q.data?.plan.status === "pending_client" || q.data?.plan.status === "client_approved",
  });

  // Projeto é escolhido explicitamente: nunca criado automaticamente aqui.
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectDialogReason, setProjectDialogReason] = useState<"organize" | "submit">("organize");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const approve = useMutation({
    mutationFn: () => approvePlan({ data: { planId, brandId, clientId } }),
    onSuccess: (res) => {
      toast.success(`${res.created} posts criados no Kanban.`);
      navigate({ to: "/content" });
    },
    onError: (e) => {
      const m = describeError(e);
      toast.error(
        m.includes("client_approval_required")
          ? "O cliente precisa aprovar a pauta antes de gerar os cards."
          : `Falha ao aprovar: ${m}`,
      );
    },
  });

  const discard = useMutation({
    mutationFn: () => discardPlan({ data: { planId } }),
    onSuccess: () => {
      toast.success("Pauta descartada.");
      onDiscarded();
    },
    onError: (e) => toast.error(`Falha ao descartar: ${describeError(e)}`),
  });

  const canDeleteQ = useQuery({
    queryKey: ["plan-can-delete", brandId],
    queryFn: () => canDeleteAuthority({ data: { brandId } }),
    staleTime: 5 * 60_000,
  });
  const hardDelete = useMutation({
    mutationFn: () => deletePlan({ data: { planId, brandId, clientId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-board", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["monthly-plans", "list", brandId, clientId] });
      setDeleteOpen(false);
      toast.success("Pauta excluída definitivamente.");
      onDiscarded();
    },
    onError: (e) => toast.error(describePlanDeleteError(e)),
  });



  if (q.isLoading || !q.data) {
    return (
      <PlanShell embedded={embedded} className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      </PlanShell>
    );
  }

  const { plan, topics } = q.data;
  const locked = plan.status === "pending_client" || plan.status === "approved";
  const approvedTopics = topics.filter((t) => t.status === "approved");
  const pendingTopics = topics.filter((t) => t.status === "pending");
  const incomplete = approvedTopics.filter((t) => !t.channel || !t.content_format);
  const clientApprovedCount = topics.filter((t) => t.client_status === "approved").length;
  const clientChangesCount = topics.filter((t) => t.client_status === "changes").length;
  const clientRejectedCount = topics.filter((t) => t.client_status === "rejected").length;
  const clientLink = linkQ.data ? `${window.location.origin}${linkQ.data.url}` : null;

  return (
    <div className="pb-40 sm:pb-32">
      <PlanShell embedded={embedded} className="space-y-6 sm:space-y-8">
        {(plan.status === "changes_requested" || plan.status === "client_rejected") &&
        plan.client_feedback ? (
          <p className="text-xs text-amber-400">Feedback do cliente: {plan.client_feedback}</p>
        ) : null}

        {plan.internal_approved_at ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FolderKanban className="h-3.5 w-3.5 text-violet-400" />
            {plan.project_id ? (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() =>
                  navigate({ to: "/projects/$projectId", params: { projectId: plan.project_id! } })
                }
              >
                Ver projeto
              </button>
            ) : (
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => {
                  setProjectDialogReason("organize");
                  setProjectDialogOpen(true);
                }}
              >
                Escolher projeto
              </button>
            )}
          </div>
        ) : null}

        {/* Estratégia */}
        <section className="space-y-5 rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur">
          <InlineEditable
            as="h1"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
            value={plan.title}
            onSave={(v) => savePlan.mutate({ title: v })}
            multiline={false}
            placeholder="Headline da pauta"
          />
          <ContextSourcesRow sources={plan.context_sources ?? null} />
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Descrição
              </div>
              <InlineEditable
                as="div"
                className="text-sm text-foreground/90"
                value={plan.description ?? ""}
                onSave={(v) => savePlan.mutate({ description: v })}
                multiline
                placeholder="Contexto do mês…"
              />
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Objetivos
              </div>
              <InlineEditable
                as="div"
                className="whitespace-pre-line text-sm text-foreground/90"
                value={plan.objectives ?? ""}
                onSave={(v) => savePlan.mutate({ objectives: v })}
                multiline
                placeholder="O que esperamos alcançar…"
              />
            </div>
          </div>
        </section>

        {/* Tópicos */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Ideias de posts</h2>
              <p className="text-xs text-muted-foreground">
                {topics.length} itens · {approvedTopics.length} aprovados · {pendingTopics.length}{" "}
                sem decisão
                {clientApprovedCount + clientChangesCount + clientRejectedCount > 0
                  ? ` · cliente: ${clientApprovedCount} aprovados · ${clientChangesCount} com ajuste · ${clientRejectedCount} rejeitados`
                  : ""}
              </p>
            </div>
            {!locked ? (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="gap-1.5 border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                  onClick={() => approveAll.mutate(pendingTopics.map((t) => t.id))}
                  disabled={approveAll.isPending || pendingTopics.length === 0}
                >
                  {approveAll.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCheck className="h-4 w-4" />
                  )}
                  Aprovar todos ({pendingTopics.length})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => addTopic.mutate()}
                  disabled={addTopic.isPending}
                >
                  <Plus className="h-4 w-4" /> Novo tópico
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {topics.map((t) => (
              <TopicCard
                key={t.id}
                topic={t}
                locked={locked}
                regenerating={regenM.isPending && regenM.variables?.topicId === t.id}
                onStatus={(status) => topicDecision.mutate({ topicId: t.id, status })}
                onRegenerate={(instruction) => regenM.mutate({ topicId: t.id, instruction })}
                onUndo={() => undoM.mutate(t.id)}
                onPatch={(patch) => {
                  qc.setQueryData<MonthlyPlanWithTopics | null>(["monthly-plan", planId], (p) =>
                    p
                      ? {
                          ...p,
                          topics: p.topics.map((x) => (x.id === t.id ? { ...x, ...patch } : x)),
                        }
                      : p,
                  );
                  patchTopic.mutate({ topicId: t.id, patch });
                }}
                onDelete={() => removeTopic.mutate(t.id)}
              />
            ))}
          </div>
        </section>
      </PlanShell>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur">
        <div className="flex w-full flex-col gap-2 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3 sm:px-6 lg:px-8">
          <Button variant="outline" className="gap-1.5" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>

          <Button
            variant="outline"
            className="gap-1.5 border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => discard.mutate()}
            disabled={discard.isPending}
          >
            <X className="h-4 w-4" /> Descartar pauta
          </Button>

          {canDeleteQ.data?.canDelete && (
            <Button
              variant="outline"
              className="gap-1.5 border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={hardDelete.isPending}
            >
              <Trash2 className="h-4 w-4" /> Excluir definitivamente
            </Button>
          )}



          {clientLink ? (
            <Button
              variant="secondary"
              className="gap-1.5"
              onClick={() => {
                void navigator.clipboard?.writeText(clientLink);
                toast.success("Link de aprovação copiado.");
              }}
            >
              <LinkIcon className="h-4 w-4" /> Copiar link do cliente
            </Button>
          ) : null}

          {plan.status === "client_approved" ? (
            <Button
              className="gap-2"
              onClick={() => approve.mutate()}
              disabled={approve.isPending || approvedTopics.length === 0}
            >
              {approve.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Enviar para produção ({approvedTopics.length})
            </Button>
          ) : (
            <Button
              className="gap-2"
              onClick={() => submitM.mutate()}
              disabled={
                submitM.isPending ||
                plan.status === "pending_client" ||
                approvedTopics.length === 0 ||
                pendingTopics.length > 0 ||
                incomplete.length > 0
              }
              title={
                pendingTopics.length > 0
                  ? "Aprove ou descarte todos os itens"
                  : incomplete.length > 0
                    ? "Há itens aprovados sem plataforma/formato"
                    : undefined
              }
            >
              {submitM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {plan.status === "pending_client"
                ? "Aguardando cliente"
                : "Enviar ao cliente para aprovação"}
            </Button>
          )}
        </div>
      </div>

      <LinkPautaProjectDialog
        open={projectDialogOpen}
        onOpenChange={setProjectDialogOpen}
        brandId={brandId}
        clientId={clientId}
        planId={planId}
        planTitle={plan.title ?? "Pauta"}
        requireProject
        onLinked={() => {
          invalidate();
          if (projectDialogReason === "submit") submitM.mutate();
        }}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta pauta definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              “{plan.title ?? "Pauta"}” e todos os seus itens serão apagados. Esta ação é
              irreversível. O projeto vinculado é preservado. Se a pauta já gerou peças de conteúdo,
              a exclusão é bloqueada — arquive-a para preservar o histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={hardDelete.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={hardDelete.isPending}
              onClick={(e) => {
                e.preventDefault();
                hardDelete.mutate();
              }}
            >
              {hardDelete.isPending ? "Excluindo…" : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* --------------------------------------------------------------- */

function TopicCard({
  topic,
  onPatch,
  onDelete,
  onStatus,
  onRegenerate,
  onUndo,
  regenerating,
  locked,
}: {
  topic: MonthlyPlanTopic;
  onPatch: (p: Partial<MonthlyPlanTopic>) => void;
  onDelete: () => void;
  onStatus: (s: "pending" | "approved" | "rejected") => void;
  onRegenerate: (instruction: string) => void;
  onUndo: () => void;
  regenerating: boolean;
  locked: boolean;
}) {
  const [instrOpen, setInstrOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const complete = !!(topic.channel && topic.content_format);
  const missing = !complete;

  return (
    <div
      className={`group relative rounded-xl border p-4 transition ${
        topic.status === "approved"
          ? "border-emerald-500/40 bg-emerald-500/5"
          : topic.status === "rejected"
            ? "border-border/40 bg-muted/30 opacity-70"
            : "border-border/60 bg-card/40 hover:border-border"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
            topic.status === "approved"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : topic.status === "rejected"
                ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                : "border-amber-500/30 bg-amber-500/10 text-amber-400"
          }`}
        >
          {topic.status === "approved"
            ? "Aprovado"
            : topic.status === "rejected"
              ? "Descartado"
              : "Pendente"}
        </span>
        {!locked ? (
          <button
            onClick={onDelete}
            className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            aria-label="Remover tópico"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {topic.client_status && topic.client_status !== "pending" ? (
        <div className="mb-2 space-y-1">
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
              topic.client_status === "approved"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : topic.client_status === "changes"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-400"
            }`}
          >
            {topic.client_status === "approved"
              ? "Aprovado pelo cliente"
              : topic.client_status === "changes"
                ? "Ajuste pedido pelo cliente"
                : "Rejeitado pelo cliente"}
          </span>
          {topic.client_comment ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              “{topic.client_comment}”
            </p>
          ) : null}
        </div>
      ) : null}

      <InlineEditable
        as="div"
        className="pr-6 text-sm font-semibold text-foreground"
        value={topic.topic_title}
        onSave={(v) => onPatch({ topic_title: v })}
        multiline={false}
        placeholder="Título do post"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select value={topic.channel ?? ""} onValueChange={(v) => onPatch({ channel: v })}>
          <SelectTrigger
            className={`h-7 w-fit gap-1 bg-background/60 px-2 text-xs ${
              topic.channel ? "border-border/60" : "border-amber-500/50 text-amber-500"
            }`}
          >
            <SelectValue placeholder="Plataforma *" />
          </SelectTrigger>
          <SelectContent>
            {PLAN_CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>
                {CHANNEL_LABEL[c] ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={normalizeContentFormat(topic.content_format) ?? ""}
          onValueChange={(v) => onPatch({ content_format: v })}
        >
          <SelectTrigger
            className={`h-7 w-fit gap-1 bg-background/60 px-2 text-xs ${
              topic.content_format ? "border-border/60" : "border-amber-500/50 text-amber-500"
            }`}
          >
            <SelectValue placeholder="Formato *" />
          </SelectTrigger>
          <SelectContent>
            {CONTENT_FORMATS.map((f) => (
              <SelectItem key={f} value={f}>
                {CONTENT_FORMAT_LABEL[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {missing ? (
        <p className="mt-2 text-[11px] text-amber-500">
          Defina plataforma e formato para aprovar este item.
        </p>
      ) : null}
      <div className="mt-3">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Gancho
        </div>
        <InlineEditable
          as="div"
          className="text-xs leading-relaxed text-muted-foreground"
          value={topic.angle ?? ""}
          onSave={(v) => onPatch({ angle: v })}
          multiline
          placeholder="Gancho estratégico / direcionamento…"
        />
      </div>
      {topic.target_audience ? (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Público-alvo
          </div>
          <InlineEditable
            as="div"
            className="text-xs leading-relaxed text-foreground/80"
            value={topic.target_audience}
            onSave={(v) => onPatch({ target_audience: v })}
            multiline={false}
            placeholder="Persona ou cohort…"
          />
        </div>
      ) : null}
      {topic.rationale ? (
        <p className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">Por quê: </span>
          {topic.rationale}
        </p>
      ) : null}

      {!locked ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3">
            <Button
              size="sm"
              variant="outline"
              className={`h-7 gap-1 px-2 text-xs ${
                topic.status === "approved"
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                  : ""
              }`}
              disabled={missing}
              title={missing ? "Defina plataforma e formato" : undefined}
              onClick={() => onStatus(topic.status === "approved" ? "pending" : "approved")}
            >
              <Check className="h-3.5 w-3.5" /> Aprovar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={`h-7 gap-1 px-2 text-xs ${
                topic.status === "rejected"
                  ? "border border-rose-500/30 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                  : ""
              }`}
              onClick={() => onStatus(topic.status === "rejected" ? "pending" : "rejected")}
            >
              <X className="h-3.5 w-3.5" /> Descartar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              disabled={regenerating}
              onClick={() => setInstrOpen((v) => !v)}
            >
              {regenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Regenerar
            </Button>
            {topic.previous_title ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                onClick={onUndo}
              >
                <Undo2 className="h-3.5 w-3.5" /> Desfazer
              </Button>
            ) : null}
          </div>

          {instrOpen ? (
            <div className="mt-2 space-y-2">
              <Textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="O que ajustar? (opcional) — plataforma e formato serão mantidos"
                className="text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={regenerating}
                  onClick={() => {
                    onRegenerate(instruction.trim());
                    setInstrOpen(false);
                    setInstruction("");
                  }}
                >
                  Gerar nova versão
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => setInstrOpen(false)}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- */

function InlineEditable({
  value,
  onSave,
  multiline,
  className,
  placeholder,
  as = "div",
}: {
  value: string;
  onSave: (v: string) => void;
  multiline: boolean;
  className?: string;
  placeholder?: string;
  as?: "div" | "h1";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value ?? "").trim()) onSave(next);
  };

  if (editing) {
    return multiline ? (
      <Textarea
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
        }}
        rows={3}
        className={className}
      />
    ) : (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
          if (e.key === "Enter") commit();
        }}
        className={className}
      />
    );
  }

  const Tag = as;
  const isEmpty = !value || !value.trim();
  return (
    <Tag
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={`${className ?? ""} -mx-1 cursor-text rounded px-1 transition hover:bg-muted/40 ${
        isEmpty ? "text-muted-foreground/60 italic" : ""
      }`}
    >
      {isEmpty ? (placeholder ?? "Clique para editar") : value}
    </Tag>
  );
}
