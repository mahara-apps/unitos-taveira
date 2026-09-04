import { useEffect, useState } from "react";
import { readApiError } from "@/lib/errors";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Instagram as InstagramIcon,
  Loader2,
  Sparkles,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  getBrandHub,
  updateBrandHub,
  type BrandHubClient,
  type BrandHubData,
} from "@/lib/brand-hub.functions";
import { supabase } from "@/integrations/supabase/client";
import { BriefingImportDialog } from "./briefing-import-dialog";

type SocialKey = "instagram" | "tiktok" | "linkedin" | "youtube" | "facebook";
const SOCIALS: Array<{ key: SocialKey; label: string }> = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "youtube", label: "YouTube" },
  { key: "facebook", label: "Facebook" },
];

type State = {
  tone_text: string;
  mission: string;
  positioning: string;
  offer: string;
  price_range: string;
  audience: string;
  pain_points: string;
  volumetry: Record<SocialKey, number>;
  goals: string;
};

const EMPTY: State = {
  tone_text: "",
  mission: "",
  positioning: "",
  offer: "",
  price_range: "",
  audience: "",
  pain_points: "",
  volumetry: { instagram: 0, tiktok: 0, linkedin: 0, youtube: 0, facebook: 0 },
  goals: "",
};

function fromHub(hub: BrandHubData, toneFallback?: string | null): State {
  return {
    tone_text: hub.tone_text ?? toneFallback ?? "",
    mission: hub.mission ?? "",
    positioning: hub.positioning ?? "",
    offer: hub.offer ?? "",
    price_range: hub.price_range ?? "",
    audience: hub.audience ?? "",
    pain_points: hub.pain_points ?? "",
    volumetry: {
      instagram: hub.volumetry?.instagram ?? 0,
      tiktok: hub.volumetry?.tiktok ?? 0,
      linkedin: hub.volumetry?.linkedin ?? 0,
      youtube: hub.volumetry?.youtube ?? 0,
      facebook: hub.volumetry?.facebook ?? 0,
    },
    goals: hub.goals ?? "",
  };
}

export function QuickOnboardingWizard({
  brandId,
  clientId,
  open,
  onOpenChange,
  onOpenFullBriefing,
}: {
  brandId: string;
  clientId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onOpenFullBriefing?: () => void;
}) {
  const qc = useQueryClient();
  const fetchHub = useServerFn(getBrandHub);
  const saveHub = useServerFn(updateBrandHub);

  const hubQ = useQuery({
    queryKey: ["brand-hub", brandId, clientId],
    queryFn: () => fetchHub({ data: { brandId, clientId } }),
    enabled: open,
  });

  const [step, setStep] = useState(1);
  const [state, setState] = useState<State>(EMPTY);
  const [genLoading, setGenLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Seed state from current hub once loaded / whenever wizard opens.
  useEffect(() => {
    if (open && hubQ.data) {
      setState(fromHub(hubQ.data.brand_hub ?? {}, hubQ.data.tone_of_voice));
    }
  }, [open, hubQ.data]);

  useEffect(() => {
    if (open) setStep(1);
    if (!open) setAiOpen(false);
  }, [open, clientId]);


  const save = useMutation({
    mutationFn: async (patch: Partial<BrandHubData>) => {
      await saveHub({ data: { brandId, clientId, patch } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-hub", brandId, clientId] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao salvar"),
  });

  const setField = <K extends keyof State>(k: K, v: State[K]) =>
    setState((s) => ({ ...s, [k]: v }));

  const advance = async (patch: Partial<BrandHubData>) => {
    await save.mutateAsync(patch);
    setStep((s) => Math.min(s + 1, 4));
  };

  const skip = () => setStep((s) => Math.min(s + 1, 4));
  const skipAll = () => onOpenChange(false);

  const runStrategy = async () => {
    setGenLoading(true);
    try {
      // Persist current step before firing, if user landed on completion.
      await save.mutateAsync({
        volumetry: state.volumetry,
        goals: state.goals,
      });

      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      const res = await fetch("/api/jobs/customer-pipeline", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          brandId,
          clientId,
          pautasQuantidade: 8,
          pautasPeriodo: "próximos 15 dias",
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Falha ao iniciar a estratégia."));
      toast.success("Inteligência rodando em segundo plano — acompanhe pelo indicador de IA.");
      qc.invalidateQueries({ queryKey: ["ai-jobs", "active"] });
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar a estratégia");
    } finally {
      setGenLoading(false);
    }
  };

  const totalSteps = 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] gap-0 overflow-hidden rounded-2xl border border-border/60 p-0 shadow-2xl">
        <DialogHeader className="space-y-0 px-8 pb-6 pt-8">
          <div className="mb-1 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="text-xl font-semibold tracking-tight">
                Onboarding rápido
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                Só o essencial para a IA gerar a primeira estratégia.
              </DialogDescription>
            </div>
            <StepBadge step={step} total={totalSteps} />
          </div>
          <StepTrack step={step} total={totalSteps} />
        </DialogHeader>

        <div className="max-h-[64vh] overflow-y-auto px-8 pb-8">
          {hubQ.isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : aiOpen ? (
            <div className="space-y-3 pt-2">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold">Preencher com IA</h3>
                  <p className="text-xs text-muted-foreground">
                    Você pode enviar briefing, transcrição de reunião, pesquisa, planilha ou outros
                    materiais da marca.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setAiOpen(false)}>
                  Voltar ao preenchimento
                </Button>
              </div>
              <BriefingImportDialog
                brandId={brandId}
                clientId={clientId}
                open={aiOpen}
                onOpenChange={(v) => setAiOpen(v)}
                embedded
                sourceLabel="Onboarding Rápido"
                onApplied={async () => {
                  const fresh = await hubQ.refetch();
                  if (fresh.data) {
                    setState(fromHub(fresh.data.brand_hub ?? {}, fresh.data.tone_of_voice));
                  }
                  setAiOpen(false);
                  toast.success("Campos do onboarding atualizados — revise e siga para a próxima etapa.");
                }}
              />
            </div>
          ) : step === 1 ? (
            <StepIdentity state={state} setField={setField} client={hubQ.data ?? null} />
          ) : step === 2 ? (
            <StepProductAudience state={state} setField={setField} />
          ) : step === 3 ? (
            <StepGoals state={state} setField={setField} />
          ) : (
            <StepDone />
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-8 py-4">
          <button
            type="button"
            onClick={skipAll}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Pular e ver tudo
          </button>

          <div className="flex items-center gap-4">
            {!aiOpen && step <= totalSteps && (
              <div className="hidden flex-col items-end sm:flex">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAiOpen(true)}
                  className="gap-1.5 border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Gerar com IA
                </Button>
                <span className="mt-1 text-[11px] text-muted-foreground">
                  Envie materiais da marca e deixe a IA preencher o briefing para você.
                </span>
              </div>
            )}
            {!aiOpen && step <= totalSteps && (
              <button
                type="button"
                onClick={() => setAiOpen(true)}
                className="text-sm font-medium text-primary sm:hidden"
              >
                Gerar com IA
              </button>
            )}
            {!aiOpen && step <= totalSteps && (
              <button
                type="button"
                onClick={skip}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                disabled={save.isPending}
              >
                Pular esta etapa
              </button>
            )}


            {!aiOpen && step === 1 && (
              <Button
                size="default"
                onClick={() =>
                  advance({
                    tone_text: state.tone_text,
                    mission: state.mission,
                    positioning: state.positioning,
                  })
                }
                disabled={save.isPending}
                className="gap-1.5 shadow-sm transition-transform active:scale-[0.98]"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Próximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {!aiOpen && step === 2 && (
              <Button
                size="default"
                onClick={() =>
                  advance({
                    offer: state.offer,
                    price_range: state.price_range,
                    audience: state.audience,
                    pain_points: state.pain_points,
                  })
                }
                disabled={save.isPending}
                className="gap-1.5 shadow-sm transition-transform active:scale-[0.98]"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Próximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {!aiOpen && step === 3 && (
              <Button
                size="default"
                onClick={() => advance({ volumetry: state.volumetry, goals: state.goals })}
                disabled={save.isPending}
                className="gap-1.5 shadow-sm transition-transform active:scale-[0.98]"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Concluir
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {!aiOpen && step > totalSteps && (
              <>
                <Button
                  variant="ghost"
                  size="default"
                  onClick={() => {
                    onOpenChange(false);
                    onOpenFullBriefing?.();
                  }}
                >
                  Ver briefing completo
                </Button>
                <Button
                  size="default"
                  onClick={runStrategy}
                  disabled={genLoading}
                  className="gap-1.5 bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white shadow-md transition-transform hover:from-fuchsia-500 hover:to-violet-500 active:scale-[0.98]"
                >
                  {genLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Gerar Inteligência com IA
                </Button>
              </>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function StepBadge({ step, total }: { step: number; total: number }) {
  const label = step > total ? "Concluído" : `Passo ${step} de ${total}`;
  return (
    <span className="whitespace-nowrap rounded-md bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
      {label}
    </span>
  );
}

function StepTrack({ step, total }: { step: number; total: number }) {
  return (
    <div
      className="mt-6 flex gap-1.5"
      aria-label={`Progresso: ${Math.min(step, total)} de ${total}`}
    >
      {Array.from({ length: total }).map((_, i) => {
        const idx = i + 1;
        const done = step > idx;
        const current = step === idx;
        return (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-500",
              done || current ? "bg-primary" : "bg-muted",
            )}
          />
        );
      })}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group space-y-2">
      <Label className="text-sm font-medium text-foreground transition-colors group-focus-within:text-primary">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function StepIdentity({
  state,
  setField,
  client,
}: {
  state: State;
  setField: <K extends keyof State>(k: K, v: State[K]) => void;
  client: BrandHubClient | null;
}) {
  const socials = (client?.socials ?? {}) as Record<string, string | undefined>;
  const igRaw = (socials.instagram ?? "").trim();
  const igHandle = igRaw
    ? igRaw
        .replace(/^@+/, "")
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
        .replace(/\/+$/, "")
    : "";
  const color = (client?.color ?? "").trim();
  const hasCapturedData = !!(
    client?.name ||
    client?.niche ||
    igHandle ||
    color ||
    client?.logo_url
  );

  return (
    <div className="space-y-8 pt-2">
      {hasCapturedData ? (
        <div className="flex items-start justify-between gap-4 rounded-xl border border-border/60 bg-muted/40 px-4 py-3">
          <div className="min-w-0 space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Já capturado no cadastro
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {client?.logo_url ? (
                <img
                  src={client.logo_url}
                  alt=""
                  className="h-7 w-7 rounded-md border border-border bg-background object-contain"
                />
              ) : null}
              {client?.name ? (
                <span className="truncate text-sm font-semibold text-foreground">
                  {client.name}
                </span>
              ) : null}
              {client?.niche ? (
                <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {client.niche}
                </span>
              ) : null}
              {igHandle ? (
                <a
                  href={`https://instagram.com/${igHandle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  <InstagramIcon className="h-3 w-3" />@{igHandle}
                  <ExternalLink className="h-2.5 w-2.5 opacity-70" />
                </a>
              ) : null}
              {color ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full ring-4 ring-offset-0"
                    style={{
                      background: color,
                      // subtle ring using the color itself at low opacity
                      boxShadow: `0 0 0 4px ${color}1a`,
                    }}
                  />
                  <span className="font-mono text-[11px] uppercase text-muted-foreground">
                    {color}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="space-y-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          Identidade
        </h3>
        <div className="space-y-5">
          <Field label="Tom de voz" hint="Ex.: próximo, provocador, direto, com humor.">
            <Textarea
              rows={3}
              value={state.tone_text}
              onChange={(e) => setField("tone_text", e.target.value)}
              placeholder="Como a marca fala com o público?"
            />
          </Field>
          <Field label="Missão">
            <Textarea
              rows={3}
              value={state.mission}
              onChange={(e) => setField("mission", e.target.value)}
              placeholder="Por que essa marca existe?"
            />
          </Field>
          <Field label="Posicionamento" hint="O lugar que a marca ocupa na cabeça do público.">
            <Textarea
              rows={3}
              value={state.positioning}
              onChange={(e) => setField("positioning", e.target.value)}
              placeholder="Para quem, contra quem, com que promessa."
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function StepProductAudience({
  state,
  setField,
}: {
  state: State;
  setField: <K extends keyof State>(k: K, v: State[K]) => void;
}) {
  return (
    <div className="space-y-6 pt-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
        Produto & Público
      </h3>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Oferta principal">
            <Input
              value={state.offer}
              onChange={(e) => setField("offer", e.target.value)}
              placeholder="Ex.: Consultoria de branding"
            />
          </Field>
          <Field label="Faixa de preço">
            <Input
              value={state.price_range}
              onChange={(e) => setField("price_range", e.target.value)}
              placeholder="Ex.: R$ 3-8k / projeto"
            />
          </Field>
        </div>
        <Field label="Descrição do público">
          <Textarea
            rows={3}
            value={state.audience}
            onChange={(e) => setField("audience", e.target.value)}
            placeholder="Quem compra: idade, contexto, comportamento."
          />
        </Field>
        <Field label="Dores">
          <Textarea
            rows={3}
            value={state.pain_points}
            onChange={(e) => setField("pain_points", e.target.value)}
            placeholder="Frustrações que esse público sente hoje."
          />
        </Field>
      </div>
    </div>
  );
}

function StepGoals({
  state,
  setField,
}: {
  state: State;
  setField: <K extends keyof State>(k: K, v: State[K]) => void;
}) {
  return (
    <div className="space-y-6 pt-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">Metas</h3>

      <div className="space-y-3 rounded-xl border border-border/60 bg-muted/40 p-4">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Volumetria semanal por canal</Label>
          <span className="text-[11px] text-muted-foreground">posts / semana</span>
        </div>
        <div className="grid gap-2">
          {SOCIALS.map((s) => (
            <div key={s.key} className="grid grid-cols-[80px_1fr_32px] items-center gap-3">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <Slider
                min={0}
                max={14}
                step={1}
                value={[state.volumetry[s.key] ?? 0]}
                onValueChange={([v]) =>
                  setField("volumetry", { ...state.volumetry, [s.key]: v ?? 0 })
                }
              />
              <span className="text-right text-xs tabular-nums text-foreground">
                {state.volumetry[s.key] ?? 0}
              </span>
            </div>
          ))}
        </div>
      </div>

      <Field
        label="Metas e restrições"
        hint="Objetivos, KPIs, temas proibidos, regras de compliance."
      >
        <Textarea
          rows={4}
          value={state.goals}
          onChange={(e) => setField("goals", e.target.value)}
          placeholder="Ex.: crescer 20% em seguidores, evitar tema política."
        />
      </Field>
    </div>
  );
}

function StepDone() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <div className={cn("rounded-full bg-emerald-500/10 p-3 text-emerald-500")}>
        <CheckCircle2 className="h-8 w-8" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight">Base pronta</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        Os campos essenciais foram salvos. Você já pode gerar a primeira inteligência com IA — voz,
        personas, cohorts e SWOT — ou refinar o briefing completo antes.
      </p>
    </div>
  );
}
