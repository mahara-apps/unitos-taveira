import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { PLAN_CHANNELS, PLAN_CHANNEL_LABEL, type PlanChannel } from "@/lib/monthly-plan-fields";
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABEL,
  breakdownFromTotal,
  formatsForChannel,
  sumChannelBreakdown,
  type ContentFormat,
} from "@/lib/content-formats";
import {
  PautaOrganizationField,
  requiredOrganization,
  toOrganizationInput,
  type OrganizationDraft,
} from "@/components/monthly-plan/pauta-organization-field";
import type { PlanOrganizationInput } from "@/lib/monthly-plans.functions";
import type { PlanVolumetry } from "./volumetry-cards";

export type GenerateSelection = {
  channel: PlanChannel;
  quantity: number;
  formats: string[];
  /** Cota por formato canônico — fonte da distribuição na geração. */
  formatQuotas: Partial<Record<ContentFormat, number>>;
};

export type OverageItem = {
  channel: PlanChannel;
  quota: number;
  requested: number;
  overage: number;
};

const STEPS = ["Escopo", "Canais", "Volumetria por formato"] as const;

export function GeneratePlanWizard({
  open,
  onOpenChange,
  brandId,
  clientId,
  volumetry,
  briefings,
  pending,
  loadingMessage,
  generationError,
  onGenerate,
  onRequestOverage,
  requestingOverage,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  clientId: string;
  volumetry: PlanVolumetry | undefined;
  briefings: Array<{ id: string; label: string }>;
  pending: boolean;
  loadingMessage: string;
  generationError?: string | null;
  onGenerate: (input: {
    theme: string;
    briefingId: string | null;
    selection: GenerateSelection[];
    organization: PlanOrganizationInput;
  }) => void;
  onRequestOverage?: (items: OverageItem[], justification: string) => void;
  requestingOverage?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState("");
  const [briefingId, setBriefingId] = useState("__none");
  const [org, setOrg] = useState<OrganizationDraft>(requiredOrganization);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  /** Fonte de verdade da seleção: canal → formato → quantidade. */
  const [fmtQty, setFmtQty] = useState<Record<string, Partial<Record<ContentFormat, number>>>>({});
  const [justification, setJustification] = useState("");

  // Projeto é obrigatório na criação da pauta: "nenhum" não é aceito.
  const organization = toOrganizationInput(org, false);


  const channels = useMemo(
    () => PLAN_CHANNELS.filter((c) => (volumetry?.monthlyQuota[c] ?? 0) > 0),
    [volumetry],
  );

  // Pré-preenche com o disponível do mês, respeitando o breakdown do briefing.
  useEffect(() => {
    if (!open || !volumetry) return;
    const nextEnabled: Record<string, boolean> = {};
    const nextFmt: Record<string, Partial<Record<ContentFormat, number>>> = {};
    for (const c of channels) {
      const quota = volumetry.monthlyQuota[c] ?? 0;
      const available = Math.max(0, quota - (volumetry.generatedThisMonth[c] ?? 0));
      nextEnabled[c] = available > 0;
      const target = available > 0 ? available : quota;
      const briefingBucket = (volumetry.formatQuota?.[c] ?? {}) as Partial<
        Record<ContentFormat, number>
      >;
      const briefingTotal = sumChannelBreakdown(briefingBucket);
      if (briefingTotal > 0 && target > 0) {
        // Reescala o breakdown do briefing para o volume disponível no mês.
        const bucket: Partial<Record<ContentFormat, number>> = {};
        const entries = CONTENT_FORMATS.filter((f) => (briefingBucket[f] ?? 0) > 0);
        let left = target;
        entries.forEach((f, idx) => {
          const share =
            idx === entries.length - 1
              ? left
              : Math.min(left, Math.round((briefingBucket[f]! / briefingTotal) * target));
          if (share > 0) bucket[f] = share;
          left -= share;
        });
        nextFmt[c] = bucket;
      } else {
        nextFmt[c] = breakdownFromTotal(c, target, volumetry.formatsByChannel[c] ?? []);
      }
    }
    setEnabled(nextEnabled);
    setFmtQty(nextFmt);
    setOrg(requiredOrganization);
    setStep(0);
  }, [open, volumetry, channels]);

  const qtyOf = (c: string) => sumChannelBreakdown(fmtQty[c]);
  const activeChannels = channels.filter((c) => enabled[c] && qtyOf(c) > 0);
  const total = activeChannels.reduce((s, c) => s + qtyOf(c), 0);
  const allowanceFor = (c: PlanChannel) =>
    Math.max(
      0,
      (volumetry?.monthlyQuota[c] ?? 0) +
        (volumetry?.approvedOverage?.[c] ?? 0) -
        (volumetry?.generatedThisMonth[c] ?? 0),
    );
  const overageItems: OverageItem[] = activeChannels
    .map((c) => {
      const allowance = allowanceFor(c);
      const requested = qtyOf(c);
      return { channel: c, quota: allowance, requested, overage: requested - allowance };
    })
    .filter((it) => it.overage > 0);
  /**
   * Excedente liberado sem aprovação: autoridade do usuário (Super Admin /
   * Owner / Admin) ou política de volumetria livre no cliente/workspace.
   */
  const overageAllowed = Boolean(volumetry?.canBypassOverage) || volumetry?.overagePolicy === "warn";
  const missingFormats = channels.filter((c) => enabled[c] && qtyOf(c) === 0);

  const setFormatQty = (c: string, f: ContentFormat, n: number) =>
    setFmtQty((prev) => {
      const bucket = { ...(prev[c] ?? {}) };
      const qty = Math.max(0, Math.min(60, Math.round(n || 0)));
      if (qty > 0) bucket[f] = qty;
      else delete bucket[f];
      return { ...prev, [c]: bucket };
    });

  const submit = () => {
    if (!organization) return;
    onGenerate({
      organization,
      theme: theme.trim(),
      briefingId: briefingId === "__none" ? null : briefingId,
      selection: activeChannels.map((c) => ({
        channel: c,
        quantity: qtyOf(c),
        formats: CONTENT_FORMATS.filter((f) => (fmtQty[c]?.[f] ?? 0) > 0),
        formatQuotas: fmtQty[c] ?? {},
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (pending ? null : onOpenChange(v))}>
      <DialogContent className="max-w-xl">
        {pending ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm font-medium">{loadingMessage}</p>
            <p className="text-xs text-muted-foreground">
              Gerando {total} peças — isso pode levar até um minuto.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Gerar pauta com IA</DialogTitle>
              <DialogDescription>
                Passo {step + 1} de {STEPS.length} · {STEPS[step]}
              </DialogDescription>
            </DialogHeader>

            <div className="flex gap-1.5">
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  className={`h-1 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`}
                />
              ))}
            </div>

            {step === 0 ? (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Tema do mês{" "}
                    <span className="normal-case text-muted-foreground/70">(opcional)</span>
                  </label>
                  <Input
                    autoFocus
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    placeholder="Ex.: Mês das Mães focado em vendas"
                    className="h-10"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    O briefing do cliente é sempre usado como contexto pela IA.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Briefing específico (opcional)
                  </label>
                  <Select value={briefingId} onValueChange={setBriefingId}>
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Nenhum briefing" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Nenhum</SelectItem>
                      {briefings.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="h-px bg-border/60" />

                <PautaOrganizationField
                  brandId={brandId}
                  clientId={clientId}
                  value={org}
                  onChange={setOrg}
                  allowNone={false}
                />
                {!organization ? (
                  <p className="text-[11px] text-muted-foreground">
                    Escolha um projeto existente ou informe o nome do novo projeto para continuar.
                  </p>
                ) : null}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="space-y-2 py-2">
                <p className="text-xs text-muted-foreground">
                  Selecione os canais e as quantidades que a IA deve gerar.
                </p>
                {channels.map((c) => {
                  const quota = volumetry?.monthlyQuota[c] ?? 0;
                  const generated = volumetry?.generatedThisMonth[c] ?? 0;
                  const available = Math.max(0, quota - generated);
                  return (
                    <div
                      key={c}
                      className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 p-3"
                    >
                      <Checkbox
                        checked={!!enabled[c]}
                        onCheckedChange={(v) => setEnabled((p) => ({ ...p, [c]: !!v }))}
                        aria-label={PLAN_CHANNEL_LABEL[c]}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{PLAN_CHANNEL_LABEL[c]}</div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          cota {quota}/mês · {generated} gerados · {available} disponíveis
                        </div>
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-foreground/80">
                        {qtyOf(c)} peças
                      </span>
                    </div>
                  );
                })}
                <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs">
                  <span className="text-muted-foreground">Total a gerar</span>
                  <span className="font-medium tabular-nums">{total} peças</span>
                </div>
                {overageItems.length ? (
                  <p className="text-[11px] text-amber-400">
                    Excede a volumetria em:{" "}
                    {overageItems
                      .map((it) => `${PLAN_CHANNEL_LABEL[it.channel]} (+${it.overage})`)
                      .join(", ")}
                    .{" "}
                    {overageAllowed
                      ? "Você pode gerar acima da volumetria; o excedente será registrado."
                      : "Será necessário solicitar liberação do gestor."}
                  </p>
                ) : null}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Defina quantas peças por formato a IA deve gerar em cada canal.
                </p>
                {channels
                  .filter((c) => enabled[c])
                  .map((c) => (
                    <div key={c} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium">{PLAN_CHANNEL_LABEL[c]}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {qtyOf(c)} peças
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {formatsForChannel(c).map((f) => (
                          <div
                            key={f}
                            className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5"
                          >
                            <span className="text-xs">{CONTENT_FORMAT_LABEL[f]}</span>
                            <Stepper
                              value={fmtQty[c]?.[f] ?? 0}
                              min={0}
                              max={60}
                              label={`${CONTENT_FORMAT_LABEL[f]} em ${PLAN_CHANNEL_LABEL[c]}`}
                              onChange={(n) => setFormatQty(c, f, n)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                {missingFormats.length ? (
                  <p className="text-[11px] text-amber-400">
                    Selecione ao menos um formato para:{" "}
                    {missingFormats.map((c) => PLAN_CHANNEL_LABEL[c]).join(", ")}.
                  </p>
                ) : null}
                {overageItems.length ? (
                  <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                    <div className="flex gap-2 text-xs text-amber-400">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-medium">
                          {overageAllowed
                            ? "Excedente de volumetria (liberado)"
                            : "Excedente de volumetria"}
                        </p>
                        <ul className="mt-1 space-y-0.5 tabular-nums">
                          {overageItems.map((it) => (
                            <li key={it.channel}>
                              {PLAN_CHANNEL_LABEL[it.channel]}: {it.requested} pedidas · {it.quota}{" "}
                              disponíveis · +{it.overage} excedente
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    {overageAllowed ? (
                      <p className="text-[11px] text-muted-foreground">
                        {volumetry?.canBypassOverage
                          ? "Seu nível de acesso permite gerar acima da volumetria. O excedente fica registrado no histórico de Produção."
                          : "Volumetria livre está ativa para este cliente. O excedente fica registrado no histórico de Produção."}
                      </p>
                    ) : (
                      <>
                        <Input
                          value={justification}
                          onChange={(e) => setJustification(e.target.value)}
                          placeholder="Justificativa para o gestor (opcional)"
                          className="h-9"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={requestingOverage}
                          onClick={() => onRequestOverage?.(overageItems, justification.trim())}
                          className="gap-1.5"
                        >
                          {requestingOverage ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Solicitar liberação
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}
                {generationError ? (
                  <div
                    role="alert"
                    className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>{generationError}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                variant="ghost"
                onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))}
                className="gap-1"
              >
                {step === 0 ? (
                  "Cancelar"
                ) : (
                  <>
                    <ArrowLeft className="h-4 w-4" /> Voltar
                  </>
                )}
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  className="gap-1"
                  disabled={(step === 0 && !organization) || (step === 1 && total === 0)}
                  onClick={() => setStep(step + 1)}
                >
                  Continuar <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  className="gap-2"
                  disabled={
                    !organization ||
                    total === 0 ||
                    missingFormats.length > 0 ||
                    (overageItems.length > 0 && !overageAllowed)
                  }
                  onClick={submit}
                >
                  <Sparkles className="h-4 w-4" /> Gerar {total} peças
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
