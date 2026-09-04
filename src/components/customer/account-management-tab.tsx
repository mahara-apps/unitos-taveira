import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check,
  ChevronRight,
  CircleCheck,
  Clock,
  FileText,
  FolderPlus,
  History as HistoryIcon,
  Info,
  Lock,
  Route,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAccessRole } from "@/hooks/use-access-role";
import {
  getClientAccountFn,
  updateClientAccountFn,
  moveClientJourneyStageFn,
  JOURNEY_STAGES,
  JOURNEY_STAGE_LABEL,
  CONTRACT_STATUS_LABEL,
  type JourneyStage,
  type ClientAccount,
} from "@/lib/client-journey.functions";
import { listBrandTeam } from "@/lib/team.functions";
import { listTemplatesFn } from "@/lib/project-templates.functions";
import { PortalLinkCard } from "@/components/customer/portal-link-card";
import {
  ProfileEmpty,
  ProfileField,
  ProfileFieldGrid,
  ProfilePageHeader,
  ProfileSaveBar,
  ProfileSection,
  ProfileSectionsSkeleton,
  ProfileStat,
} from "@/components/customer/ui/profile-ui";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DATE_FMT = new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" });

export function AccountManagementTab({ brandId, clientId }: { brandId: string; clientId: string }) {
  const qc = useQueryClient();
  const fetchAccount = useServerFn(getClientAccountFn);
  const fetchTeam = useServerFn(listBrandTeam);
  const fetchTemplates = useServerFn(listTemplatesFn);
  const updateAccount = useServerFn(updateClientAccountFn);
  const moveStage = useServerFn(moveClientJourneyStageFn);
  const { role } = useAccessRole();
  const canEdit = role === "admin";

  const accountQ = useQuery({
    queryKey: ["client-journey", clientId],
    queryFn: () => fetchAccount({ data: { brandId, clientId } }),
    staleTime: 30_000,
  });
  const teamQ = useQuery({
    queryKey: ["brand-team", brandId],
    queryFn: () => fetchTeam({ data: { brandId } }),
    staleTime: 60_000,
    enabled: canEdit,
  });
  const templatesQ = useQuery({
    queryKey: ["project-templates", brandId],
    queryFn: () => fetchTemplates({ data: { brandId } }),
    staleTime: 60_000,
  });

  const updateMut = useMutation({
    mutationFn: updateAccount,
    onSuccess: () => {
      toast.success("Informações atualizadas.");
      qc.invalidateQueries({ queryKey: ["client-journey", clientId] });
      qc.invalidateQueries({ queryKey: ["clients", brandId] });
    },
    onError: (e: Error) => toast.error("Falha ao salvar", { description: e.message }),
  });

  const moveMut = useMutation({
    mutationFn: moveStage,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["client-journey", clientId] });
      qc.invalidateQueries({ queryKey: ["clients", brandId] });
      if (res?.projectId) {
        toast.success("Estágio atualizado e projeto criado.", {
          description: res.projectName ?? undefined,
        });
      } else {
        toast.success("Estágio atualizado.");
      }
    },
    onError: (e: Error) =>
      toast.error("Não foi possível mover o estágio", { description: e.message }),
  });

  const [moveDialog, setMoveDialog] = useState<{ open: boolean; stage: JourneyStage | null }>({
    open: false,
    stage: null,
  });

  if (accountQ.isLoading || !accountQ.data) {
    return <ProfileSectionsSkeleton sections={3} />;
  }

  const { account, timeline, stageMappings } = accountQ.data;
  const currentStage = account.journey_stage as JourneyStage;
  const currentIdx = JOURNEY_STAGES.indexOf(currentStage);
  const mappingByStage = new Map(stageMappings.map((m) => [m.stage, m]));

  const openMove = (stage: JourneyStage) => {
    if (!canEdit) {
      toast.error("Sem permissão", { description: "Apenas admin pode mover a jornada." });
      return;
    }
    setMoveDialog({ open: true, stage });
  };

  return (
    <div className="space-y-4 pb-2">
      <ProfilePageHeader
        title="Gestão da conta"
        description="Controle as informações operacionais e administrativas deste cliente."
        badge={
          canEdit ? (
            <Badge tone="emerald">Edição liberada</Badge>
          ) : (
            <Badge tone="amber" className="gap-1">
              <Lock className="h-3 w-3" /> Somente leitura
            </Badge>
          )
        }
      />

      {!canEdit && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-[12px] text-amber-600 dark:text-amber-300">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Você tem acesso somente leitura à gestão desta conta.
        </div>
      )}

      <AccountInfoCard
        account={account}
        canEdit={canEdit}
        team={teamQ.data?.members ?? []}
        onSubmit={(patch) => updateMut.mutate({ data: { brandId, clientId, patch } })}
        isSaving={updateMut.isPending}
      />

      <JourneyPipeline
        currentIdx={currentIdx}
        mappingByStage={mappingByStage}
        onSelect={openMove}
        canEdit={canEdit}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PortalLinkCard clientId={clientId} clientName={account.name ?? null} />
        <JourneyHistory timeline={timeline} />
      </div>

      <MoveDialog
        open={moveDialog.open}
        onOpenChange={(o) => setMoveDialog((s) => ({ ...s, open: o }))}
        currentStage={currentStage}
        toStage={moveDialog.stage}
        mapping={moveDialog.stage ? (mappingByStage.get(moveDialog.stage) ?? null) : null}
        templates={templatesQ.data ?? []}
        isSubmitting={moveMut.isPending}
        onConfirm={(payload) => {
          if (!moveDialog.stage) return;
          moveMut.mutate(
            {
              data: {
                brandId,
                clientId,
                toStage: moveDialog.stage,
                note: payload.note || undefined,
                createProject: payload.createProject,
                projectTemplateId: payload.projectTemplateId ?? undefined,
              },
            },
            {
              onSuccess: () => setMoveDialog({ open: false, stage: null }),
            },
          );
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Info card                                                                 */
/* -------------------------------------------------------------------------- */

type AccountForm = {
  monthly_contract_value: string;
  margin_percent: string;
  contract_start_date: string;
  contract_renewal_date: string;
  contract_status: string;
  internal_notes: string;
  owner_user_id: string;
};

function AccountInfoCard({
  account,
  canEdit,
  team,
  onSubmit,
  isSaving,
}: {
  account: ClientAccount;
  canEdit: boolean;
  team: Array<{ user_id: string; full_name: string | null }>;
  onSubmit: (patch: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<AccountForm>(() => toForm(account));
  useEffect(() => setForm(toForm(account)), [account]);

  const mrr = account.monthly_contract_value ?? 0;
  const daysToRenewal = account.contract_renewal_date
    ? Math.round((new Date(account.contract_renewal_date).getTime() - Date.now()) / 86_400_000)
    : null;
  const tenureMonths = account.contract_start_date
    ? Math.max(
        0,
        Math.round(
          (Date.now() - new Date(account.contract_start_date).getTime()) / (30 * 86_400_000),
        ),
      )
    : null;

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(toForm(account)),
    [form, account],
  );

  const submit = () => {
    onSubmit({
      monthly_contract_value: form.monthly_contract_value
        ? Number(form.monthly_contract_value.replace(",", "."))
        : null,
      margin_percent: form.margin_percent ? Number(form.margin_percent.replace(",", ".")) : null,
      contract_start_date: form.contract_start_date || null,
      contract_renewal_date: form.contract_renewal_date || null,
      contract_status: form.contract_status,
      internal_notes: form.internal_notes || null,
      owner_user_id: form.owner_user_id || null,
    });
  };

  const statusTone: Record<string, "emerald" | "amber" | "red" | "slate"> = {
    ativo: "emerald",
    pausado: "amber",
    inadimplente: "red",
    encerrado: "slate",
    cancelado: "slate",
  };
  const tone = statusTone[form.contract_status] ?? "slate";

  return (
    <>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ProfileSection
          title="Status da conta"
          subtitle="Situação contratual e indicadores comerciais"
          icon={<CircleCheck className="h-4 w-4" />}
          action={
            <Badge tone={tone} className="capitalize">
              {CONTRACT_STATUS_LABEL[form.contract_status as keyof typeof CONTRACT_STATUS_LABEL] ??
                form.contract_status}
            </Badge>
          }
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <ProfileStat label="MRR do cliente" value={BRL.format(mrr)} tone="emerald" />
            <ProfileStat
              label="Tempo de casa"
              value={
                tenureMonths == null
                  ? "—"
                  : `${tenureMonths} ${tenureMonths === 1 ? "mês" : "meses"}`
              }
            />
            <ProfileStat
              label="Renovação"
              value={
                daysToRenewal == null
                  ? "—"
                  : daysToRenewal < 0
                    ? `Vencida há ${Math.abs(daysToRenewal)}d`
                    : `${daysToRenewal} dias`
              }
              tone={
                daysToRenewal == null
                  ? "default"
                  : daysToRenewal < 0
                    ? "destructive"
                    : daysToRenewal < 30
                      ? "amber"
                      : "emerald"
              }
            />
          </div>
          <div className="mt-4">
            <ProfileFieldGrid>
              <ProfileField label="Status contratual">
                <Select
                  value={form.contract_status}
                  onValueChange={(v) => setForm((s) => ({ ...s, contract_status: v }))}
                  disabled={!canEdit}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ProfileField>
              <ProfileField label="Responsável pela conta">
                <Select
                  value={form.owner_user_id || "__none"}
                  onValueChange={(v) =>
                    setForm((s) => ({ ...s, owner_user_id: v === "__none" ? "" : v }))
                  }
                  disabled={!canEdit}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Sem responsável</SelectItem>
                    {team.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>
                        {m.full_name || m.user_id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ProfileField>
            </ProfileFieldGrid>
          </div>
        </ProfileSection>

        <ProfileSection
          title="Contrato"
          subtitle="Valores, vigência e observações internas"
          icon={<FileText className="h-4 w-4" />}
        >
          <ProfileFieldGrid>
            <ProfileField label="Valor mensal do contrato" hint="Somente números, em reais.">
              <Input
                inputMode="decimal"
                placeholder="0,00"
                disabled={!canEdit}
                value={form.monthly_contract_value}
                onChange={(e) => setForm((s) => ({ ...s, monthly_contract_value: e.target.value }))}
              />
            </ProfileField>
            <ProfileField label="Margem (%)">
              <Input
                inputMode="decimal"
                placeholder="0,00"
                disabled={!canEdit}
                value={form.margin_percent}
                onChange={(e) => setForm((s) => ({ ...s, margin_percent: e.target.value }))}
              />
            </ProfileField>
            <ProfileField label="Data de início">
              <Input
                type="date"
                disabled={!canEdit}
                value={form.contract_start_date}
                onChange={(e) => setForm((s) => ({ ...s, contract_start_date: e.target.value }))}
              />
            </ProfileField>
            <ProfileField label="Renovação prevista">
              <Input
                type="date"
                disabled={!canEdit}
                value={form.contract_renewal_date}
                onChange={(e) => setForm((s) => ({ ...s, contract_renewal_date: e.target.value }))}
              />
            </ProfileField>
            <ProfileField label="Notas internas" full>
              <Textarea
                rows={4}
                disabled={!canEdit}
                value={form.internal_notes}
                onChange={(e) => setForm((s) => ({ ...s, internal_notes: e.target.value }))}
                placeholder="Contexto do contrato, particularidades, histórico comercial…"
                className="resize-y"
              />
            </ProfileField>
          </ProfileFieldGrid>
        </ProfileSection>
      </div>

      {canEdit && (
        <ProfileSaveBar
          dirty={dirty}
          saving={isSaving}
          onSave={submit}
          onDiscard={() => setForm(toForm(account))}
          hint="Nenhuma alteração pendente"
        />
      )}
    </>
  );
}

function toForm(a: ClientAccount): AccountForm {
  return {
    monthly_contract_value:
      a.monthly_contract_value != null ? String(a.monthly_contract_value) : "",
    margin_percent: a.margin_percent != null ? String(a.margin_percent) : "",
    contract_start_date: a.contract_start_date ?? "",
    contract_renewal_date: a.contract_renewal_date ?? "",
    contract_status: a.contract_status ?? "ativo",
    internal_notes: a.internal_notes ?? "",
    owner_user_id: a.owner_user_id ?? "",
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pipeline                                                                  */
/* -------------------------------------------------------------------------- */

function JourneyPipeline({
  currentIdx,
  mappingByStage,
  onSelect,
  canEdit,
}: {
  currentIdx: number;
  mappingByStage: Map<string, { project_template_name: string | null }>;
  onSelect: (stage: JourneyStage) => void;
  canEdit: boolean;
}) {
  return (
    <ProfileSection
      title="Jornada do cliente"
      subtitle={`Etapa atual: ${JOURNEY_STAGE_LABEL[JOURNEY_STAGES[currentIdx] ?? "onboarding"]}`}
      icon={<Route className="h-4 w-4" />}
      footer={
        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {canEdit
            ? "Clique em uma etapa para mover o cliente. Etapas com template criam um projeto automaticamente."
            : "Somente admins podem mover o cliente entre etapas."}
        </p>
      }
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:flex xl:flex-nowrap xl:items-stretch">
        {JOURNEY_STAGES.map((stage, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          const map = mappingByStage.get(stage);
          return (
            <button
              key={stage}
              type="button"
              onClick={() => onSelect(stage)}
              disabled={!canEdit}
              className={cn(
                "group min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-left transition",
                active
                  ? "border-primary/50 bg-primary/10 ring-1 ring-primary/20"
                  : done
                    ? "border-emerald-500/30 bg-emerald-500/[0.07]"
                    : "border-border/50 bg-background/40 hover:border-border hover:bg-accent/40",
                !canEdit && "cursor-not-allowed opacity-70",
              )}
            >
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {done ? (
                  <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                ) : active ? (
                  <Sparkles className="h-3 w-3 shrink-0 text-primary" />
                ) : (
                  <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-border/60" />
                )}
                Etapa {i + 1}
              </div>
              <div
                className={cn(
                  "mt-1 truncate text-[13px] font-semibold",
                  active && "text-primary",
                  done && "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {JOURNEY_STAGE_LABEL[stage]}
              </div>
              {map?.project_template_name && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <FolderPlus className="h-3 w-3 shrink-0" />
                  <span className="truncate">{map.project_template_name}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </ProfileSection>
  );
}

/* -------------------------------------------------------------------------- */
/*  History                                                                   */
/* -------------------------------------------------------------------------- */

function JourneyHistory({
  timeline,
}: {
  timeline: Array<{
    id: string;
    from_stage: string | null;
    to_stage: string;
    note: string | null;
    moved_by_name: string | null;
    project_id: string | null;
    project_name: string | null;
    created_at: string;
  }>;
}) {
  return (
    <ProfileSection
      title="Histórico da jornada"
      subtitle={
        timeline.length === 0
          ? "Sem movimentações registradas"
          : `${timeline.length} evento(s) registrados`
      }
      icon={<HistoryIcon className="h-4 w-4" />}
      bodyClassName={timeline.length === 0 ? undefined : "px-0 py-0"}
    >
      {timeline.length === 0 ? (
        <ProfileEmpty
          icon={<HistoryIcon className="h-4 w-4" />}
          title="Nenhuma movimentação ainda"
          hint="Quando você mover o cliente entre etapas, os eventos aparecerão aqui."
        />
      ) : (
        <ol className="divide-y divide-border/40">
          {timeline.map((ev) => {
            const from = ev.from_stage
              ? (JOURNEY_STAGE_LABEL[ev.from_stage as JourneyStage] ?? ev.from_stage)
              : null;
            const to = JOURNEY_STAGE_LABEL[ev.to_stage as JourneyStage] ?? ev.to_stage;
            return (
              <li key={ev.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {from && (
                      <>
                        <Badge variant="outline" className="text-[10px] font-medium">
                          {from}
                        </Badge>
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      </>
                    )}
                    <Badge tone="blue" className="text-[10px]">
                      {to}
                    </Badge>
                    {ev.project_name && (
                      <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                        <FolderPlus className="h-3 w-3" />
                        {ev.project_name}
                      </span>
                    )}
                  </div>
                  {ev.note && <div className="mt-1 text-xs text-muted-foreground">{ev.note}</div>}
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {DATE_FMT.format(new Date(ev.created_at))}
                    {ev.moved_by_name && <span>· por {ev.moved_by_name}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </ProfileSection>
  );
}

/* -------------------------------------------------------------------------- */
/*  Move dialog                                                               */
/* -------------------------------------------------------------------------- */

function MoveDialog({
  open,
  onOpenChange,
  currentStage,
  toStage,
  mapping,
  templates,
  isSubmitting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentStage: JourneyStage;
  toStage: JourneyStage | null;
  mapping: { project_template_id: string | null; project_template_name: string | null } | null;
  templates: Array<{ id: string; name: string }>;
  isSubmitting: boolean;
  onConfirm: (payload: {
    note: string;
    createProject: boolean;
    projectTemplateId: string | null;
  }) => void;
}) {
  const [note, setNote] = useState("");
  const [createProject, setCreateProject] = useState(true);
  const [tplId, setTplId] = useState<string>("");

  useEffect(() => {
    if (open) {
      setNote("");
      setCreateProject(true);
      setTplId(mapping?.project_template_id ?? "");
    }
  }, [open, mapping]);

  if (!toStage) return null;
  const isBackward = JOURNEY_STAGES.indexOf(toStage) < JOURNEY_STAGES.indexOf(currentStage);
  const same = toStage === currentStage;
  const templateName =
    templates.find((t) => t.id === tplId)?.name ?? mapping?.project_template_name ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover para {JOURNEY_STAGE_LABEL[toStage]}</DialogTitle>
          <DialogDescription>
            {same
              ? "Este cliente já está nesta etapa."
              : isBackward
                ? `Você está retornando o cliente de ${JOURNEY_STAGE_LABEL[currentStage]} para uma etapa anterior.`
                : `Avançar de ${JOURNEY_STAGE_LABEL[currentStage]} para ${JOURNEY_STAGE_LABEL[toStage]}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Nota (opcional)">
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contexto da movimentação"
            />
          </Field>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={createProject}
                onChange={(e) => setCreateProject(e.target.checked)}
              />
              <span>
                <span className="font-medium">
                  Criar projeto de {JOURNEY_STAGE_LABEL[toStage]} automaticamente
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {templateName
                    ? `Usará o template "${templateName}", já mapeado para esta etapa.`
                    : "Selecione um template abaixo para gerar o projeto padrão."}
                </span>
              </span>
            </label>
            {createProject && (
              <div className="mt-3">
                <Select
                  value={tplId || "__none"}
                  onValueChange={(v) => setTplId(v === "__none" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Não criar projeto</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            disabled={isSubmitting || same}
            onClick={() =>
              onConfirm({
                note,
                createProject: createProject && !!tplId,
                projectTemplateId: createProject && tplId ? tplId : null,
              })
            }
          >
            {isSubmitting ? "Movendo…" : `Mover para ${JOURNEY_STAGE_LABEL[toStage]}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
