import { useEffect, useRef, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Rocket,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  cancelInstallationOperationFn,
  completeInstallationOperationFn,
  getInstallationFn,
  getAutomationCapabilityFn,
  refreshInstallationHealthFn,
  resumeAutomatedProvisionFn,
  restartAutomatedProvisionFn,
  runAutomatedProvisionFn,
  runAutomatedValidateFn,
  runAutomatedUpdateFn,
  getMasterVersionFn,
  startInstallationOperationFn,
  updateInstallationFn,
} from "@/lib/installation/manager.functions";

import {
  CHECK_STATE_LABEL,
  HEALTH_CHECKS,
  INFRA_HEALTH_CHECK_IDS,
  INSTALLATION_HEALTH_LABEL,
  OPERATION_KIND_LABEL,
  canStartOperation,
  isOperationStale,
  updateSummary,
  type InstallationHealth,
  type InstallationOperationKind,
} from "@/lib/installation/manager-contract";
import {
  CORE_REQUIREMENTS,
  CORE_STATE_LABEL,
  OPTIONAL_CONFIG,
  OPTIONAL_STATE_LABEL,
  OVERALL_STATE_ICON,
  OVERALL_STATE_LABEL,
  computeReadiness,
  customDomainState,
  isTemporaryDeployUrl,
  type OptionalState,
} from "@/lib/installation/readiness-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTimeBr } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
  CheckList,
  CheckRow,
  CollapsibleChecks,
  DataCell,
  DataGrid,
  LifecycleSteps,
  StateBadge,
  VersionPair,
  formatVersion,
  lifecycleIndex,
  type VisualState,
} from "@/components/installations/installation-visuals";
import {
  LiveOperationBar,
  OperationStatusBadge,
  StepList,
  failedStepLabel,
} from "@/components/installations/operation-views";
import { InstallationCredentialsCard } from "@/components/installations/installation-credentials-card";

export const Route = createFileRoute("/_authenticated/admin/instalacoes/$id")({
  validateSearch: (search: Record<string, unknown>): { novo?: true } =>
    search["novo"] === true || search["novo"] === "true" ? { novo: true } : {},
  component: InstallationDetailPage,
  head: () => ({
    meta: [
      { title: "Instalação · Administração Unitos" },
      {
        name: "description",
        content:
          "Provisionamento, validação, saúde e histórico de uma instalação independente do Unitos.",
      },
      { property: "og:title", content: "Instalação · Administração Unitos" },
      {
        property: "og:description",
        content: "Acompanhe provisionamento, validação e saúde da instalação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const HEALTH_STATE: Record<InstallationHealth, VisualState> = {
  unknown: "pending",
  healthy: "ok",
  degraded: "attention",
  failing: "error",
};

const OPTIONAL_STATE: Record<OptionalState, VisualState> = {
  configured: "ok",
  pending: "attention",
  not_configured: "pending",
};

/** Campos editáveis da instalação — o domínio pode mudar depois do cadastro. */
type EditForm = {
  name: string;
  domain: string;
  supabaseUrl: string;
  supabaseProjectRef: string;
  gitRepoUrl: string;
  deployProject: string;
  notes: string;
};

const EMPTY_FORM: EditForm = {
  name: "",
  domain: "",
  supabaseUrl: "",
  supabaseProjectRef: "",
  gitRepoUrl: "",
  deployProject: "",
  notes: "",
};

function InstallationDetailPage() {
  const { id } = Route.useParams();
  const { novo } = Route.useSearch();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const getFn = useServerFn(getInstallationFn);
  const startFn = useServerFn(startInstallationOperationFn);
  const completeFn = useServerFn(completeInstallationOperationFn);
  const cancelFn = useServerFn(cancelInstallationOperationFn);
  const healthFn = useServerFn(refreshInstallationHealthFn);
  const capabilityFn = useServerFn(getAutomationCapabilityFn);
  const autoFn = useServerFn(runAutomatedProvisionFn);
  const autoValidateFn = useServerFn(runAutomatedValidateFn);
  const autoUpdateFn = useServerFn(runAutomatedUpdateFn);
  const masterVersionFn = useServerFn(getMasterVersionFn);
  const restartFn = useServerFn(restartAutomatedProvisionFn);
  const resumeFn = useServerFn(resumeAutomatedProvisionFn);
  const editFn = useServerFn(updateInstallationFn);

  const [runCommand, setRunCommand] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);

  const [updateOpen, setUpdateOpen] = useState(false);
  const [opsPageRaw, setOpsPage] = useState(1);
  const [tab, setTab] = useState("visao");
  const resumePendingRef = useRef(false);

  const detail = useQuery({
    queryKey: ["installation", id],
    queryFn: () => getFn({ data: { id } }),
    retry: false,
    // Progresso REAL: só faz polling enquanto existe operação viva.
    refetchInterval: (query) =>
      query.state.data?.operations.some(
        (op) => op.status === "pending" || op.status === "running",
      )
        ? 2500
        : false,
  });

  // Provisionamento automático: o MASTER usa as próprias credenciais de gestão.
  // Sem elas, a UI mostra o motivo do BLOCKED e mantém o fallback manual.
  const capability = useQuery({
    // Capability DESTA instalação: credenciais próprias têm precedência sobre
    // as do MASTER, então a chave precisa incluir o id.
    queryKey: ["installation-automation", id],
    queryFn: () => capabilityFn({ data: { id } }),
    retry: false,
    staleTime: 60_000,
  });
  // Versão disponível no MASTER (commit atual da branch). Só leitura.
  const masterVersion = useQuery({
    queryKey: ["installation-master-version"],
    queryFn: () => masterVersionFn({ data: undefined }),
    retry: false,
    staleTime: 60_000,
  });
  const automated = capability.data?.available === true;
  // Atualizar código só depende do token de deploy — não do Supabase Management.
  const deployAutomated = capability.data?.vercel.available === true;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["installation", id] });
    void qc.invalidateQueries({ queryKey: ["installations"] });
  };

  const start = useMutation({
    mutationFn: (input: { kind: InstallationOperationKind; confirm?: boolean }) =>
      startFn({
        data: {
          id,
          kind: input.kind as "provision" | "validate" | "update",
          confirm: input.confirm,
        },
      }),
    onSuccess: (result) => {
      setRunCommand(result.runCommand);
      setUpdateOpen(false);
      toast.success(
        automated
          ? "Operação aberta."
          : "Operação aberta. Execute a operação na instalação de destino.",
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const autoProvision = useMutation({
    mutationFn: () => autoFn({ data: { id } }),
    onSuccess: (result) => {
      if (result.result === "STARTED") {
        toast.success("Provisionamento iniciado. Acompanhe o progresso por etapa abaixo.");
      } else {
        toast.error(`BLOCKED: ${result.reasons.join(" | ")}`);
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Validação: READ-ONLY e executada pelo próprio MASTER. O comando manual só
  // volta a aparecer quando a automação estiver realmente indisponível.
  const autoValidate = useMutation({
    mutationFn: () => autoValidateFn({ data: { id } }),
    onSuccess: (result) => {
      if (result.result === "STARTED") {
        toast.success("Validação iniciada. Acompanhe o resultado por etapa abaixo.");
      } else {
        toast.error(`BLOCKED: ${result.reasons.join(" | ")}`);
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Traz o código publicado no MASTER para o deploy da instalação.
  const autoUpdate = useMutation({
    mutationFn: (input?: { commitSha?: string | null }) =>
      autoUpdateFn({ data: { id, commitSha: input?.commitSha ?? null } }),
    onSuccess: (result) => {
      if (result.result === "STARTED") {
        toast.success("Atualização iniciada. Acompanhe o progresso por etapa abaixo.");
      } else {
        toast.error(`BLOCKED: ${result.reasons.join(" | ")}`);
      }
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const restartProvision = useMutation({
    mutationFn: (input: { force: boolean }) => restartFn({ data: { id, force: input.force } }),
    onSuccess: (result) => {
      if (result.result === "STARTED") toast.success("Provisionamento reiniciado.");
      else toast.error(`BLOCKED: ${result.reasons.join(" | ")}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resumeProvision = useMutation({
    mutationFn: async () => {
      resumePendingRef.current = true;
      try {
        return await resumeFn({ data: { id } });
      } finally {
        resumePendingRef.current = false;
      }
    },
    onSuccess: (result) => {
      if (result.resumed) invalidate();
    },
  });

  // O Worker pode ser reciclado entre lotes. Enquanto esta tela acompanha uma
  // operação automática, o watchdog agenda a próxima fatia curta do baseline;
  // a lease condicional no servidor evita execução concorrente.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const live = detail.data?.operations.find(
        (op) =>
          (op.status === "pending" || op.status === "running") && op.detail.automated === true,
      );
      if (live && !resumePendingRef.current) resumeProvision.mutate();
    }, 6_000);
    return () => window.clearInterval(timer);
  }, [detail.data?.operations]);

  const complete = useMutation({
    mutationFn: (input: { operationId: string; ok: boolean; version?: string | null }) =>
      completeFn({ data: input }),
    onSuccess: () => {
      toast.success("Resultado registrado.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (operationId: string) => cancelFn({ data: { operationId } }),
    onSuccess: () => {
      toast.success("Operação cancelada. Resultado parcial preservado.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const health = useMutation({
    mutationFn: () => healthFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Saúde reavaliada.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Edição dos dados da instalação: o domínio definitivo normalmente só chega
  // depois do provisionamento, então precisa ser alterável sem recadastrar.
  const edit = useMutation({
    mutationFn: () =>
      editFn({
        data: {
          id,
          name: form.name.trim(),
          domain: form.domain,
          supabaseUrl: form.supabaseUrl,
          supabaseProjectRef: form.supabaseProjectRef,
          gitRepoUrl: form.gitRepoUrl,
          deployProject: form.deployProject,
          notes: form.notes,
        },
      }),
    onSuccess: () => {
      toast.success("Dados da instalação atualizados.");
      setEditOpen(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (detail.isLoading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando instalação…
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <Card>
        <CardContent className="space-y-3 py-14 text-center text-sm text-muted-foreground">
          <p>{(detail.error as Error | null)?.message ?? "Instalação indisponível."}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate({ to: "/admin/instalacoes" })}
          >
            Voltar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const inst = detail.data.installation;
  const operations = detail.data.operations;
  const opsPerPage = 10;
  const opsTotalPages = Math.max(1, Math.ceil(operations.length / opsPerPage));
  const opsPage = Math.min(Math.max(1, opsPageRaw), opsTotalPages);
  const pagedOperations = operations.slice((opsPage - 1) * opsPerPage, opsPage * opsPerPage);
  const activeOp = operations.find((op) => op.status === "pending" || op.status === "running");
  const lastProvision = operations.find((op) => op.kind === "provision" || op.kind === "update");
  const lastValidate = operations.find((op) => op.kind === "validate");
  const shownProvision = activeOp?.kind === "validate" ? lastProvision : (activeOp ?? lastProvision);
  const staleActive = !!activeOp && isOperationStale(activeOp);
  const failedProvision =
    lastProvision && lastProvision.status === "failed" ? lastProvision : null;

  // Estado definitivo: o núcleo decide READY; integrações opcionais nunca
  // bloqueiam. O MASTER só afirma "configurado" no que a instalação reportou.
  const readiness = computeReadiness({
    core: inst.healthChecks,
    optional: { custom_domain: customDomainState(inst.domain) },
    operationRunning: !!activeOp,
  });
  const optionalConfigured = OPTIONAL_CONFIG.filter(
    (o) => readiness.optional[o.id] === "configured",
  ).length;
  const coreLabel = (coreId: (typeof CORE_REQUIREMENTS)[number]["id"]) =>
    CORE_REQUIREMENTS.find((r) => r.id === coreId)?.label ?? coreId;

  const updatePending =
    !!masterVersion.data?.commitSha && inst.pinnedCommitSha !== masterVersion.data.commitSha;

  const openEdit = () => {
    setForm({
      name: inst.name,
      domain: inst.domain ?? "",
      supabaseUrl: inst.supabaseUrl ?? "",
      supabaseProjectRef: inst.supabaseProjectRef ?? "",
      gitRepoUrl: inst.gitRepoUrl ?? "",
      deployProject: inst.deployProject ?? "",
      notes: inst.notes ?? "",
    });
    setEditOpen(true);
  };

  const provisionAction = () =>
    automated ? autoProvision.mutate() : start.mutate({ kind: "provision" });
  const validateAction = () =>
    automated ? autoValidate.mutate() : start.mutate({ kind: "validate" });
  const updateAction = () =>
    deployAutomated
      ? autoUpdate.mutate({ commitSha: masterVersion.data?.commitSha ?? null })
      : setUpdateOpen(true);

  /** Uma única ação primária, escolhida pelo estado real da instalação. */
  const primary: {
    label: string;
    icon: typeof Rocket;
    run: () => void;
    disabled: boolean;
    pending: boolean;
  } = !inst.lastProvisionedAt
    ? {
        label: automated ? "Provisionar automaticamente" : "Provisionar instalação",
        icon: Rocket,
        run: provisionAction,
        disabled: !canStartOperation("provision", inst.status) || capability.isPending,
        pending: autoProvision.isPending || start.isPending,
      }
    : updatePending
      ? {
          label: deployAutomated ? "Autorizar atualização" : "Atualizar instalação",
          icon: ArrowDownToLine,
          run: updateAction,
          disabled: !canStartOperation("update", inst.status) || capability.isPending,
          pending: autoUpdate.isPending,
        }
      : {
          label: automated ? "Validar automaticamente" : "Validar instalação",
          icon: ShieldCheck,
          run: validateAction,
          disabled: !canStartOperation("validate", inst.status) || capability.isPending,
          pending: autoValidate.isPending,
        };
  const PrimaryIcon = primary.icon;

  return (
    <div className="space-y-5">
      {/* IDENTIDADE + AÇÕES */}
      <header className="space-y-3">
        <Link
          to="/admin/instalacoes"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Instalações
        </Link>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold">{inst.name}</h2>
              <StateBadge
                state={readiness.ready ? "ok" : "pending"}
                label={`${OVERALL_STATE_ICON[readiness.state]} ${OVERALL_STATE_LABEL[readiness.state]}`}
              />
              <StateBadge
                state={HEALTH_STATE[inst.health]}
                label={INSTALLATION_HEALTH_LABEL[inst.health]}
              />
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {inst.domain ?? "domínio não informado"}
            </p>
            <LifecycleSteps activeIndex={lifecycleIndex(inst)} complete={readiness.ready} />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" disabled={primary.disabled || primary.pending || !!activeOp} onClick={primary.run}>
              {primary.pending || activeOp ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <PrimaryIcon className="mr-1.5 h-3.5 w-3.5" />
              )}
              {activeOp ? "Em execução…" : primary.label}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" aria-label="Mais ações">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={openEdit}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Editar dados
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={
                    !!activeOp || autoProvision.isPending || !canStartOperation("provision", inst.status)
                  }
                  onClick={provisionAction}
                >
                  <Rocket className="mr-2 h-3.5 w-3.5" /> Provisionar
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={
                    !!activeOp || autoValidate.isPending || !canStartOperation("validate", inst.status)
                  }
                  onClick={validateAction}
                >
                  <ShieldCheck className="mr-2 h-3.5 w-3.5" /> Validar
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={
                    !!activeOp || autoUpdate.isPending || !canStartOperation("update", inst.status)
                  }
                  onClick={updateAction}
                >
                  <ArrowDownToLine className="mr-2 h-3.5 w-3.5" /> Puxar atualização do MASTER
                </DropdownMenuItem>
                <DropdownMenuItem disabled={health.isPending} onClick={() => health.mutate()}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" /> Reavaliar saúde
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* PROGRESSO SEMPRE VISÍVEL */}
      {activeOp && (
        <LiveOperationBar
          kind={activeOp.kind}
          percent={activeOp.progress.percent}
          done={activeOp.progress.done}
          total={activeOp.progress.total}
          steps={activeOp.steps}
        >
          <Button
            size="sm"
            variant="outline"
            disabled={restartProvision.isPending}
            onClick={() => restartProvision.mutate({ force: !staleActive })}
          >
            {restartProvision.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Reiniciar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(activeOp.id)}
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" /> Cancelar
          </Button>
        </LiveOperationBar>
      )}

      {/* VEREDITO CURTO */}
      {!activeOp &&
        (readiness.ready ? (
          <Card className="border-health-good/40 bg-health-good/5">
            <CardContent className="space-y-2 py-3.5">
              <p className="flex items-center gap-2 text-sm font-semibold text-health-good">
                <CheckCircle2 className="h-4 w-4" /> Instalação pronta e operacional
              </p>
              <CheckList>
                <CheckRow
                  state={lastValidate?.status === "success" ? "ok" : "attention"}
                  label="Validação"
                  value={
                    lastValidate?.status === "success"
                      ? formatDateTimeBr(lastValidate.finishedAt)
                      : "pendente"
                  }
                />
                <CheckRow
                  state={readiness.core.super_admin.state === "ok" ? "ok" : "attention"}
                  label="Super Admin"
                  value={
                    readiness.core.super_admin.state === "ok" ? "criado" : "pendente em /setup"
                  }
                />
                <CheckRow
                  state="ok"
                  label="Núcleo obrigatório"
                  value={`${CORE_REQUIREMENTS.length - readiness.missingCore.length - readiness.failedCore.length} de ${CORE_REQUIREMENTS.length} comprovados`}
                />
                <CollapsibleChecks
                  label="Configurações opcionais"
                  state={optionalConfigured === OPTIONAL_CONFIG.length ? "ok" : "pending"}
                  summary={`${optionalConfigured} de ${OPTIONAL_CONFIG.length} configuradas`}
                >
                  {OPTIONAL_CONFIG.map((item) => {
                    const state = readiness.optional[item.id];
                    return (
                      <CheckRow
                        key={item.id}
                        state={OPTIONAL_STATE[state]}
                        label={item.label}
                        value={OPTIONAL_STATE_LABEL[state]}
                      />
                    );
                  })}
                </CollapsibleChecks>
              </CheckList>
              {inst.domain && isTemporaryDeployUrl(inst.domain) && (
                <p className="text-xs text-muted-foreground">
                  Domínio atual é o temporário do deploy. Quando o cliente informar o definitivo, use
                  “Editar dados”.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-severity-warning/40 bg-severity-warning/5">
            <CardContent className="space-y-2 py-3.5">
              <p className="text-sm font-semibold text-severity-warning">
                Instalação ainda não confirmada como pronta
              </p>
              <CheckList>
                {readiness.failedCore.map((c) => (
                  <CheckRow key={c} state="error" label={coreLabel(c)} value="com falha" />
                ))}
                {readiness.missingCore.map((c) => (
                  <CheckRow key={c} state="pending" label={coreLabel(c)} value="não comprovado" />
                ))}
              </CheckList>
              <p className="text-xs text-muted-foreground">
                Rode “Validar” para o MASTER reler o estado real do destino.
              </p>
            </CardContent>
          </Card>
        ))}

      {novo && !inst.lastProvisionedAt && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Instalação criada.</p>
              <p className="text-xs text-muted-foreground">
                Provisione para aplicar baseline, Storage, seeds, secrets, cron e identidade própria.
              </p>
            </div>
            <Button
              size="sm"
              className="shrink-0"
              disabled={start.isPending || autoProvision.isPending || !!activeOp}
              onClick={provisionAction}
            >
              <Rocket className="mr-1.5 h-3.5 w-3.5" /> Provisionar agora
            </Button>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="versoes">Versões</TabsTrigger>
          <TabsTrigger value="saude">Saúde</TabsTrigger>
          <TabsTrigger value="acessos">Acessos</TabsTrigger>
          <TabsTrigger value="execucoes">Execuções</TabsTrigger>
        </TabsList>

        {/* VISÃO GERAL */}
        <TabsContent value="visao" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Dados da instalação</CardTitle>
            </CardHeader>
            <CardContent>
              <DataGrid columns={3}>
                <DataCell label="Domínio" value={inst.domain} />
                <DataCell label="Supabase" value={inst.supabaseUrl} mono />
                <DataCell label="Project ref" value={inst.supabaseProjectRef} mono />
                <DataCell label="Repositório" value={inst.gitRepoUrl} />
                <DataCell label="Deploy" value={inst.deployProject} />
                <DataCell
                  label="Última validação"
                  value={formatDateTimeBr(inst.lastValidatedAt)}
                />
              </DataGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-3">
              <CardTitle className="truncate text-sm">Núcleo da instalação</CardTitle>
              <StateBadge
                state={readiness.ready ? "ok" : "attention"}
                label={
                  readiness.ready
                    ? "Núcleo comprovado"
                    : `${readiness.missingCore.length} obrigatório(s) pendente(s)`
                }
              />
            </CardHeader>
            <CardContent>
              <DataGrid columns={4}>
                {CORE_REQUIREMENTS.map((req) => {
                  const result = readiness.core[req.id];
                  return (
                    <DataCell key={req.id} label={req.label}>
                      <div className="mt-1 space-y-1">
                        <StateBadge state={result.state} label={CORE_STATE_LABEL[result.state]} />
                        {result.detail && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {result.detail}
                          </p>
                        )}
                      </div>
                    </DataCell>
                  );
                })}
              </DataGrid>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-3">
              <CardTitle className="truncate text-sm">Configuração opcional</CardTitle>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                Não bloqueia a operação
              </span>
            </CardHeader>
            <CardContent>
              <DataGrid columns={3}>
                {OPTIONAL_CONFIG.map((item) => {
                  const state = readiness.optional[item.id];
                  return (
                    <DataCell key={item.id} label={item.label}>
                      <div className="mt-1">
                        <StateBadge
                          state={OPTIONAL_STATE[state]}
                          label={OPTIONAL_STATE_LABEL[state]}
                        />
                      </div>
                    </DataCell>
                  );
                })}
              </DataGrid>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ACESSOS */}
        <TabsContent value="acessos" className="space-y-4">
          <InstallationCredentialsCard installationId={id} />
        </TabsContent>


        {/* VERSÕES */}
        <TabsContent value="versoes" className="space-y-4">
          <Card>
            <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-3">
              <CardTitle className="truncate text-sm">Versão publicada</CardTitle>
              <VersionPair installed={inst.currentVersion} available={inst.availableVersion} compact />
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Esta instalação não publica sozinha: o build automático da branch está desligado e o
                código só avança quando você autoriza a atualização aqui.
              </p>
              <DataGrid columns={3}>
                <DataCell
                  label="Publicado nesta instalação"
                  mono
                  value={
                    inst.pinnedCommitSha
                      ? `${inst.pinnedRelease ? formatVersion(inst.pinnedRelease) : "—"} · ${inst.pinnedCommitSha.slice(0, 7)}`
                      : "ainda não fixado"
                  }
                />
                <DataCell
                  label="Disponível no MASTER"
                  mono
                  value={
                    masterVersion.isPending
                      ? "consultando…"
                      : masterVersion.data?.commitSha
                        ? `${masterVersion.data.release} · ${masterVersion.data.commitSha.slice(0, 7)}`
                        : (masterVersion.data?.error ?? "indisponível")
                  }
                />
                <DataCell
                  label="Autorizado em"
                  value={formatDateTimeBr(inst.pinnedAt)}
                />
              </DataGrid>
              <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
                <Button
                  size="sm"
                  disabled={
                    !deployAutomated ||
                    !!activeOp ||
                    autoUpdate.isPending ||
                    !canStartOperation("update", inst.status)
                  }
                  onClick={() =>
                    autoUpdate.mutate({ commitSha: masterVersion.data?.commitSha ?? null })
                  }
                >
                  {autoUpdate.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Autorizar atualização
                </Button>
                <span className="text-xs text-muted-foreground">
                  {updatePending
                    ? "Publica exatamente a versão listada como disponível."
                    : "Instalação já está na versão do MASTER."}
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SAÚDE */}
        <TabsContent value="saude" className="space-y-4">
          <Card>
            <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-3">
              <CardTitle className="truncate text-sm">Saúde medida pelo MASTER</CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={health.isPending}
                onClick={() => health.mutate()}
              >
                {health.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Reavaliar saúde
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <DataGrid columns={4}>
                {HEALTH_CHECKS.filter((c) =>
                  (INFRA_HEALTH_CHECK_IDS as readonly string[]).includes(c.id),
                ).map((check) => {
                  const result = inst.healthChecks[check.id];
                  return (
                    <DataCell key={check.id} label={check.label}>
                      <div className="mt-1 space-y-1">
                        <StateBadge state={result.state} label={CHECK_STATE_LABEL[result.state]} />
                        {result.detail && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {result.detail}
                          </p>
                        )}
                      </div>
                    </DataCell>
                  );
                })}
              </DataGrid>
              <p className="text-[11px] text-muted-foreground">
                {inst.healthCheckedAt
                  ? `Última medição em ${formatDateTimeBr(inst.healthCheckedAt)}.`
                  : "Nenhuma medição registrada ainda."}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* EXECUÇÕES */}
        <TabsContent value="execucoes" className="space-y-4">
          <Card>
            <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-3">
              <CardTitle className="truncate text-sm">Provisionamento</CardTitle>
              {shownProvision && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {shownProvision.progress.done}/{shownProvision.progress.total} etapas ·{" "}
                  {shownProvision.progress.percent}%
                </span>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {shownProvision ? (
                <>
                  <Progress value={shownProvision.progress.percent} className="h-1.5" />
                  {!activeOp && shownProvision.summary && (
                    <p className="text-xs text-muted-foreground">{shownProvision.summary}</p>
                  )}
                  <StepList steps={shownProvision.steps} />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {automated
                    ? "Nenhuma execução ainda. O MASTER provisiona o Supabase de destino, gera os secrets exclusivos da instalação e configura as variáveis do deploy automaticamente."
                    : "Nenhuma execução ainda. Clique em “Provisionar” para abrir a operação."}
                </p>
              )}

              {activeOp && staleActive && (
                <div className="rounded-lg border border-severity-warning/40 bg-severity-warning/5 p-2.5 text-[11px] text-muted-foreground">
                  A operação não reporta progresso há alguns minutos. Você pode reiniciar o
                  provisionamento com segurança — a operação travada é encerrada e apenas UMA nova
                  operação é aberta.
                </div>
              )}

              {failedProvision && !activeOp && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-2.5">
                  <p className="text-xs font-medium text-destructive">
                    Falhou em: {failedStepLabel(failedProvision.steps)}
                  </p>
                  {failedProvision.summary && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {failedProvision.summary}
                    </p>
                  )}
                  {failedProvision.errorKind && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Motivo: {failedProvision.errorKind}
                    </p>
                  )}
                </div>
              )}

              {automated && !activeOp && (
                <Button
                  size="sm"
                  variant={failedProvision ? "default" : "outline"}
                  disabled={autoProvision.isPending || !canStartOperation("provision", inst.status)}
                  onClick={() => autoProvision.mutate()}
                >
                  {autoProvision.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Rocket className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {failedProvision ? "Tentar novamente" : "Provisionar automaticamente"}
                </Button>
              )}

              {capability.data && !automated && (
                <div className="rounded-lg border border-severity-warning/40 bg-severity-warning/5 p-2.5">
                  <p className="text-xs font-medium">Provisionamento automático BLOCKED</p>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                    {capability.data.blockedReasons.map((reason) => (
                      <li key={reason}>• {reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>



          {lastValidate && (
            <Card>
              <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-3">
                <CardTitle className="truncate text-sm">Validação</CardTitle>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {lastValidate.progress.done} aprovados · {lastValidate.progress.failed} falhos ·{" "}
                  {lastValidate.progress.pending} pendentes
                </span>
              </CardHeader>
              <CardContent className="space-y-2">
                <StepList steps={lastValidate.steps} />
                {lastValidate.summary && (
                  <p className="text-xs text-muted-foreground">{lastValidate.summary}</p>
                )}
              </CardContent>
            </Card>
          )}

          {runCommand && !automated && (
            <Card className="border-severity-info/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Executar na instalação de destino</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  O token aparece uma única vez e expira em 2 horas. O MASTER guarda apenas o hash e
                  nunca armazena credenciais do destino.
                </p>
                <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-3 text-[11px] leading-relaxed">
                  {runCommand}
                </pre>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(runCommand);
                    toast.success("Comando copiado.");
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar comando
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 pb-3">
              <CardTitle className="truncate text-sm">Histórico de operações</CardTitle>
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {operations.length}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              {operations.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma operação registrada.</p>
              )}
              {pagedOperations.map((op) => (
                <div key={op.id} className="rounded-lg border border-border/60 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{OPERATION_KIND_LABEL[op.kind]}</span>
                    <OperationStatusBadge status={op.status} />
                    {op.detail.releaseVersion && (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {op.detail.releaseVersion}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {formatDateTimeBr(op.startedAt)}
                      {op.finishedAt
                        ? ` → ${formatDateTimeBr(op.finishedAt)}`
                        : ""}
                    </span>
                  </div>
                  {op.summary && <p className="mt-1 text-xs text-muted-foreground">{op.summary}</p>}
                  {op.errorKind && (
                    <p className="mt-1 text-xs text-destructive">Motivo: {op.errorKind}</p>
                  )}
                  {(op.status === "pending" || op.status === "running") && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {/* Operação automatizada reporta o próprio resultado: nada de registro manual. */}
                      {!op.detail.automated && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={complete.isPending}
                          onClick={() =>
                            complete.mutate({
                              operationId: op.id,
                              ok: true,
                              version: inst.availableVersion,
                            })
                          }
                        >
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Registrar sucesso
                        </Button>
                      )}
                      {!op.detail.automated && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={complete.isPending}
                          onClick={() => complete.mutate({ operationId: op.id, ok: false })}
                        >
                          <XCircle className="mr-1.5 h-3.5 w-3.5" /> Registrar falha
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(op.id)}
                      >
                        Cancelar operação
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {operations.length > opsPerPage && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                  <span className="text-[11px] text-muted-foreground">
                    {(opsPage - 1) * opsPerPage + 1}–
                    {Math.min(opsPage * opsPerPage, operations.length)} de {operations.length}{" "}
                    operações
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={opsPage <= 1}
                      onClick={() => setOpsPage(opsPage - 1)}
                    >
                      Anterior
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      {opsPage}/{opsTotalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={opsPage >= opsTotalPages}
                      onClick={() => setOpsPage(opsPage + 1)}
                    >
                      Próxima
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ATUALIZAÇÃO — confirmação obrigatória */}
      <Dialog open={updateOpen} onOpenChange={setUpdateOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Atualizar instalação</DialogTitle>
            <DialogDescription>
              {updateSummary(inst.currentVersion, inst.availableVersion)} Configurações específicas
              desta instalação (domínio, secrets, branding e integrações) não são sobrescritas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setUpdateOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={start.isPending}
              onClick={() => start.mutate({ kind: "update", confirm: true })}
            >
              {start.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar atualização
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edição dos dados da instalação — inclui a troca do domínio definitivo. */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar dados da instalação</DialogTitle>
            <DialogDescription>
              Atualize o domínio quando o definitivo for informado. Alterar aqui não redeploya:
              depois da troca, rode “Validar” para reconferir o núcleo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(
              [
                ["name", "Nome", "Instalação do cliente"],
                ["domain", "Domínio operacional", "https://cliente.com.br"],
                ["supabaseUrl", "Supabase URL", "https://xxxx.supabase.co"],
                ["supabaseProjectRef", "Supabase project ref", "xxxxxxxxxxxx"],
                ["deployProject", "Projeto de deploy", "unitos-cliente"],
                ["gitRepoUrl", "Repositório", "https://github.com/org/repo"],
                ["notes", "Notas", "observações internas"],
              ] as const
            ).map(([key, label, placeholder]) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`edit-${key}`} className="text-xs">
                  {label}
                </Label>
                <Input
                  id={`edit-${key}`}
                  value={form[key]}
                  placeholder={placeholder}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={edit.isPending || !form.name.trim()} onClick={() => edit.mutate()}>
              {edit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
