import { useEffect, useMemo, useRef, useState } from "react";
import { describeError, readApiError } from "@/lib/errors";
import { generateMonthlyPlanFn } from "@/lib/monthly-plans.functions";
import {
  PautaOrganizationField,
  requiredOrganization,
  toOrganizationInput,
  type OrganizationDraft,
} from "@/components/monthly-plan/pauta-organization-field";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  ImageIcon,
  Loader2,
  Lightbulb,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
  Instagram as InstagramIcon,
  Palette as PaletteIcon,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { BriefingImportDialog } from "@/components/brand-hub/briefing-import-dialog";

import { BriefingImportHistory } from "@/components/brand-hub/briefing-import-history";
import { DocumentsTab } from "@/components/brand-hub/documents-tab";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BriefingRequestPanel } from "@/components/brand-hub/briefing-request-panel";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { TagInput } from "@/components/ui/tag-input";
import { Textarea } from "@/components/ui/textarea";
import {
  getBrandHub,
  updateBrandHub,
  uploadBrandAsset,
  updateBrandVisuals,
  type BrandHubClient,
} from "@/lib/brand-hub.functions";
import { computeBriefingCompletion, briefingProgressLabel } from "@/lib/briefing-progress";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { CHANNELS, CHANNEL_STYLES } from "@/components/content/stage-colors";
import { FORMATS_BY_CHANNEL, FORMAT_LABEL, type PlacementFormat } from "@/lib/scheduling-formats";
import {
  PLAN_CHANNELS,
  PLAN_CHANNELS_DEFAULT,
  PLAN_CHANNEL_LABEL,
  getWeeksInMonth,
  normalizeVolumetryBasis,
  resolveQuota,
  volumetryMax,
  type PlanChannel,
  type VolumetryBasis,
} from "@/lib/monthly-plan-fields";
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABEL,
  breakdownFromTotal,
  normalizeVolumetryBreakdown,
  sumChannelBreakdown,
  formatsForChannel,
  type ContentFormat,
} from "@/lib/content-formats";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


/* ----------------------------- Types / helpers ----------------------------- */

type SocialKey = PlanChannel;

type FormState = {
  // Identidade
  tone_text: string;
  mission: string;
  positioning: string;
  values: string;
  // Produto
  offer: string;
  price_range: string;
  differentials: string;
  objections: string;
  // Público
  audience: string;
  journey: string;
  pain_points: string;
  desires: string;
  // Concorrentes
  competitor_handles: string[];
  inspirations: string[];
  // Hashtags & Estética
  hashtags: string[];
  palette: Array<{ label: string; hex: string }>;
  do_text: string;
  dont_text: string;
  // Volumetria & Metas
  /** Total por canal — derivado do breakdown (somente leitura na UI). */
  volumetry: Record<SocialKey, number>;
  volumetry_basis: VolumetryBasis;
  /** Fonte de verdade: canal → formato canônico → quantidade. */
  volumetry_breakdown: Record<SocialKey, Partial<Record<ContentFormat, number>>>;
  formats: Record<SocialKey, string[]>;
  goals: string;
};

const SOCIALS: Array<{ key: SocialKey; label: string }> = PLAN_CHANNELS.map((key) => ({
  key,
  label: PLAN_CHANNEL_LABEL[key],
}));

function toForm(client: BrandHubClient): FormState {
  const hub = client.brand_hub ?? {};
  return {
    tone_text: hub.tone_text ?? client.tone_of_voice ?? "",
    mission: hub.mission ?? "",
    positioning: hub.positioning ?? "",
    values: hub.values ?? "",
    offer: hub.offer ?? "",
    price_range: hub.price_range ?? "",
    differentials: hub.differentials ?? "",
    objections: hub.objections ?? "",
    audience: hub.audience ?? "",
    journey: hub.journey ?? "",
    pain_points: hub.pain_points ?? "",
    desires: hub.desires ?? "",
    competitor_handles: (hub.competitors ?? []).map((c) => c.handle),
    inspirations: hub.inspirations ?? [],
    hashtags: hub.hashtags ?? [],
    palette: hub.palette ?? [],
    do_text: hub.do_dont?.do ?? "",
    dont_text: hub.do_dont?.dont ?? "",
    volumetry_breakdown: PLAN_CHANNELS.reduce<
      Record<SocialKey, Partial<Record<ContentFormat, number>>>
    >(
      (acc, c) => {
        const normalized = normalizeVolumetryBreakdown(hub.volumetry_breakdown)[c];
        const legacyTotal =
          Number((hub.volumetry as Record<string, number> | undefined)?.[c] ?? 0) || 0;
        // Cliente legado (sem breakdown): deriva do total + formatos preferidos.
        acc[c] =
          normalized && Object.keys(normalized).length
            ? normalized
            : breakdownFromTotal(
                c,
                legacyTotal,
                (hub.formats as Record<string, string[]> | undefined)?.[c] ?? [],
              );
        return acc;
      },
      {} as Record<SocialKey, Partial<Record<ContentFormat, number>>>,
    ),
    volumetry: PLAN_CHANNELS.reduce<Record<SocialKey, number>>(
      (acc, c) => {
        acc[c] = Number((hub.volumetry as Record<string, number> | undefined)?.[c] ?? 0) || 0;
        return acc;
      },
      {} as Record<SocialKey, number>,
    ),
    volumetry_basis: normalizeVolumetryBasis(
      (hub as { volumetry_basis?: unknown }).volumetry_basis,
    ),
    formats: PLAN_CHANNELS.reduce<Record<SocialKey, string[]>>(
      (acc, c) => {
        const v = (hub.formats as Record<string, string[]> | undefined)?.[c];
        acc[c] = Array.isArray(v) ? v : [];
        return acc;
      },
      {} as Record<SocialKey, string[]>,
    ),
    goals: hub.goals ?? "",
  };
}

function computeCompletion(f: FormState): number {
  // Mirror the FormState back to a BrandHubData-like shape so the checklist
  // shared with the dashboard stays the single source of truth.
  return computeBriefingCompletion({
    tone_text: f.tone_text,
    mission: f.mission,
    positioning: f.positioning,
    values: f.values,
    offer: f.offer,
    price_range: f.price_range,
    differentials: f.differentials,
    objections: f.objections,
    audience: f.audience,
    journey: f.journey,
    pain_points: f.pain_points,
    desires: f.desires,
    competitors: f.competitor_handles.map((h) => ({
      id: h,
      handle: h,
      platform: "instagram",
      added_at: "",
    })),
    inspirations: f.inspirations,
    hashtags: f.hashtags,
    palette: f.palette,
    do_dont: { do: f.do_text, dont: f.dont_text },
    volumetry: f.volumetry,
    goals: f.goals,
  });
}

const progressLabel = briefingProgressLabel;

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

/* ------------------------------- Component -------------------------------- */

export function BriefingWorkspace({
  brandId,
  clientId,
  onStrategyGenerated,
  appendSlot,
}: {
  brandId: string;
  clientId: string;
  embedded?: boolean;
  onStrategyGenerated?: () => void;
  layout?: "tabs" | "stacked";
  appendSlot?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const fetchHub = useServerFn(getBrandHub);
  const saveHub = useServerFn(updateBrandHub);

  const navigate = useNavigate();
  const generatePlan = useServerFn(generateMonthlyPlanFn);
  const hubQ = useQuery({
    queryKey: ["brand-hub", brandId, clientId],
    queryFn: () => fetchHub({ data: { brandId, clientId } }),
  });

  const [form, setForm] = useState<FormState | null>(null);
  useEffect(() => {
    if (hubQ.data && !form) setForm(toForm(hubQ.data));
  }, [hubQ.data, form]);

  const [savedAt, setSavedAt] = useState<string | null>(null);
  useEffect(() => {
    if (hubQ.data?.updated_at && !savedAt) setSavedAt(hubQ.data.updated_at);
  }, [hubQ.data?.updated_at, savedAt]);

  const completion = useMemo(() => (form ? computeCompletion(form) : 0), [form]);

  // ------------- Gerar estratégia (fase 1 · pipeline de agentes) --------------
  const [regenOpen, setRegenOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [generating, setGenerating] = useState(false);

  // ------------- Gerar ideias (fase 2 · gate humano) --------------
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [ideasTheme, setIdeasTheme] = useState("");
  const [ideasOrg, setIdeasOrg] = useState<OrganizationDraft>(requiredOrganization);
  const [genIdeas, setGenIdeas] = useState(false);

  // Strategy artifacts gate — enable "Gerar ideias" only when all four exist.
  const strategyQ = useQuery({
    queryKey: ["strategy-gate", brandId, clientId],
    queryFn: async () => {
      const [v, p, c, s] = await Promise.all([
        supabase
          .from("brand_voice_cards")
          .select("id")
          .eq("brand_id", brandId)
          .eq("client_id", clientId)
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("brand_personas")
          .select("id")
          .eq("brand_id", brandId)
          .eq("client_id", clientId)
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("brand_cohorts")
          .select("id")
          .eq("brand_id", brandId)
          .eq("client_id", clientId)
          .eq("is_active", true)
          .maybeSingle(),
        supabase
          .from("brand_swot")
          .select("id")
          .eq("brand_id", brandId)
          .eq("client_id", clientId)
          .eq("is_active", true)
          .maybeSingle(),
      ]);
      return { voice: !!v.data, personas: !!p.data, cohorts: !!c.data, swot: !!s.data };
    },
    refetchOnWindowFocus: true,
  });
  const strategyReady =
    !!strategyQ.data &&
    strategyQ.data.voice &&
    strategyQ.data.personas &&
    strategyQ.data.cohorts &&
    strategyQ.data.swot;

  const runIdeas = async () => {
    setGenIdeas(true);
    try {
      // Caminho canônico ÚNICO: monthly_plans -> monthly_plan_topics -> aprovação.
      // A quantidade vem da volumetria (canal + formato) do briefing.
      const organization = toOrganizationInput(ideasOrg, false);
      if (!organization) {
        toast.error("Escolha um projeto existente ou informe o nome do novo projeto.");
        return;
      }
      const res = await generatePlan({
        data: {
          brandId,
          clientId,
          organization,
          ...(ideasTheme.trim() ? { theme: ideasTheme.trim() } : {}),
        },
      });
      if (!res.ok) {
        toast.error(describeError(new Error(res.code)));
        return;
      }
      toast.success("Pauta gerada — revise e aprove.");
      qc.invalidateQueries({ queryKey: ["monthly-plans"] });
      setIdeasOpen(false);
      void navigate({ to: "/monthly-plan/$planId", params: { planId: res.data.plan.id } });
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setGenIdeas(false);
    }
  };

  const runStrategy = async () => {
    setGenerating(true);
    try {
      // Persiste o estado atual do formulário para o backend compor o
      // briefing a partir de clients + brand_hub atualizados.
      await save.mutateAsync();
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
      toast.success(
        "Estratégia rodando em segundo plano — acompanhe pelo indicador de IA no topo.",
      );
      qc.invalidateQueries({ queryKey: ["ai-jobs", "active"] });
      qc.invalidateQueries({ queryKey: ["brand-hub", brandId, clientId] });
      setRegenOpen(false);
      onStrategyGenerated?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar a estratégia");
    } finally {
      setGenerating(false);
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const existing = hubQ.data?.brand_hub?.competitors ?? [];
      const byHandle = new Map(existing.map((c) => [c.handle.replace(/^@/, "").toLowerCase(), c]));
      const competitors = form.competitor_handles.map((raw) => {
        const handle = raw.replace(/^@/, "");
        const prev = byHandle.get(handle.toLowerCase());
        return (
          prev ?? {
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            handle,
            platform: "instagram" as const,
            added_at: new Date().toISOString(),
          }
        );
      });
      return saveHub({
        data: {
          brandId,
          clientId,
          patch: {
            tone_text: form.tone_text,
            mission: form.mission,
            positioning: form.positioning,
            values: form.values,
            offer: form.offer,
            price_range: form.price_range,
            differentials: form.differentials,
            objections: form.objections,
            audience: form.audience,
            journey: form.journey,
            pain_points: form.pain_points,
            desires: form.desires,
            inspirations: form.inspirations,
            hashtags: form.hashtags,
            palette: form.palette,
            do_dont: { do: form.do_text, dont: form.dont_text },
            volumetry: form.volumetry,
            volumetry_basis: form.volumetry_basis,
            // Fonte de verdade: o servidor recalcula `volumetry` a partir daqui.
            volumetry_breakdown: form.volumetry_breakdown as Record<string, Record<string, number>>,
            formats: form.formats,
            goals: form.goals,
            competitors,
          },
        },
      });
    },
    onSuccess: () => {
      toast.success("Briefing salvo");
      setSavedAt(new Date().toISOString());
      qc.invalidateQueries({ queryKey: ["brand-hub", brandId, clientId] });
    },
    onError: (e: Error) => toast.error(e.message || "Falha ao salvar"),
  });

  // A importação por IA agora acontece no modal `BriefingImportDialog`
  // (upload → análise → revisão). O antigo `window.prompt` foi removido.


  if (hubQ.isLoading || !form || !hubQ.data) {
    return (
      <div className="space-y-4 py-6">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-9 w-full rounded-md" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <>
      <StackedBrainLayout
        brandId={brandId}
        clientId={clientId}
        client={hubQ.data}
        form={form}
        setForm={setForm}
        completion={completion}
        onSave={() => save.mutate()}
        saving={save.isPending}
        savedAt={savedAt}
        onGenerateStrategy={() => setRegenOpen(true)}
        onGenerateIdeas={() => setIdeasOpen(true)}
        onImportAi={() => setImportOpen(true)}
        strategyReady={strategyReady}
        generating={generating}
        genIdeas={genIdeas}
        appendSlot={appendSlot}
        regenOpen={regenOpen}
        setRegenOpen={setRegenOpen}
        runStrategy={runStrategy}
        ideasOpen={ideasOpen}
        setIdeasOpen={setIdeasOpen}
        ideasTheme={ideasTheme}
        setIdeasTheme={setIdeasTheme}
        ideasOrg={ideasOrg}
        setIdeasOrg={setIdeasOrg}
        runIdeas={runIdeas}
      />
      <BriefingImportDialog
        brandId={brandId}
        clientId={clientId}
        open={importOpen}
        onOpenChange={setImportOpen}
      />
    </>
  );
}


/* ------------------------------ Shared blocks ------------------------------ */

function SectionCard({
  title,
  hint,
  children,
  className,
  action,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className={cn("border-border/60", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {hint ? <CardDescription className="text-[11px]">{hint}</CardDescription> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

function LabeledTextarea({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="resize-y bg-background text-sm"
      />
    </div>
  );
}

/* --- Identidade --- */

function IdentidadeTab({
  brandId,
  clientId,
  client,
  form,
  setForm,
}: {
  brandId: string;
  clientId: string;
  client: BrandHubClient;
  form: FormState;
  setForm: (f: FormState) => void;
}) {
  const socials = (client.socials ?? {}) as Record<string, string | undefined>;
  const igRaw = (socials.instagram ?? "").trim();
  const igHandle = igRaw
    ? igRaw
        .replace(/^@+/, "")
        .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
        .replace(/\/+$/, "")
    : "";
  const color = (client.color ?? "").trim();
  const paletteHasColor =
    !!color && form.palette.some((p) => p.hex.toLowerCase() === color.toLowerCase());
  const addColorToPalette = () => {
    if (!color || paletteHasColor) return;
    setForm({
      ...form,
      palette: [...form.palette, { label: "Cor da marca", hex: color }],
    });
  };

  return (
    <div className="space-y-4">
      <SectionCard
        title="Cadastro rápido"
        hint="Dados capturados no onboarding do cliente. Edite na aba Cadastro."
        action={
          <Button asChild size="sm" variant="ghost" className="h-7 shrink-0 text-xs">
            <Link
              to="/customers/$customerId"
              params={{ customerId: clientId }}
              search={{ tab: "conta" } as never}
            >
              Editar em Cadastro
            </Link>
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <FieldReadonly
            label="Logo"
            value={
              client.logo_url ? (
                <img
                  src={client.logo_url}
                  alt="Logo do cliente"
                  className="h-10 w-10 rounded-md border border-border object-contain bg-background"
                />
              ) : (
                "—"
              )
            }
            muted={!client.logo_url}
          />
          <FieldReadonly label="Nome" value={client.name || "—"} />
          <FieldReadonly label="Nicho" value={client.niche?.trim() || "—"} muted={!client.niche} />
          <FieldReadonly
            label="Instagram"
            value={
              igHandle ? (
                <a
                  href={`https://instagram.com/${igHandle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <InstagramIcon className="h-3.5 w-3.5" />@{igHandle}
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </a>
              ) : (
                "—"
              )
            }
            muted={!igHandle}
          />
          <FieldReadonly
            label="Cor da marca"
            value={
              color ? (
                <div className="flex items-center gap-2">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border border-border"
                    style={{ background: color }}
                  />
                  <span className="font-mono text-xs uppercase">{color}</span>
                  {!paletteHasColor ? (
                    <button
                      type="button"
                      onClick={addColorToPalette}
                      className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      title="Adicionar à paleta"
                    >
                      <PaletteIcon className="h-3 w-3" /> paleta
                    </button>
                  ) : (
                    <span className="ml-auto text-[11px] text-muted-foreground">na paleta</span>
                  )}
                </div>
              ) : (
                "—"
              )
            }
            muted={!color}
          />
          <FieldReadonly
            label="Contato"
            value={
              client.contact_name || client.contact_email ? (
                <div className="flex flex-col leading-tight">
                  {client.contact_name ? (
                    <span className="text-sm text-foreground">{client.contact_name}</span>
                  ) : null}
                  {client.contact_email ? (
                    <a
                      href={`mailto:${client.contact_email}`}
                      className="truncate text-[11px] text-primary hover:underline"
                    >
                      {client.contact_email}
                    </a>
                  ) : null}
                </div>
              ) : (
                "—"
              )
            }
            muted={!client.contact_name && !client.contact_email}
          />
        </div>
      </SectionCard>

      <SectionCard title="Ativos da marca" hint="Logos e ícone usados nas peças e nas prévias.">
        <div className="grid gap-4 md:grid-cols-3">
          <AssetSlot
            brandId={brandId}
            clientId={clientId}
            kind="logo"
            label="Logo principal"
            hint="PNG ou SVG, transparente, até 5 MB"
            currentUrl={client.logo_url}
          />
          <AssetSlot
            brandId={brandId}
            clientId={clientId}
            kind="logo_secondary"
            label="Logo alternativo"
            hint="Versão alt / mono"
            currentUrl={client.logo_secondary_url}
          />
          <AssetSlot
            brandId={brandId}
            clientId={clientId}
            kind="favicon"
            label="Ícone / avatar"
            hint="ICO/PNG 32-256 px"
            currentUrl={client.favicon_url}
          />
        </div>
      </SectionCard>

      <SectionCard title="Identidade da marca" hint="Alimenta o motor de voz e briefing da IA.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nome</Label>
            <Input value={client.name} disabled className="bg-muted/40" />
          </div>
          <LabeledTextarea
            label="Tom de voz"
            rows={3}
            value={form.tone_text}
            onChange={(v) => setForm({ ...form, tone_text: v })}
            placeholder="Ex.: consultivo, direto, com humor sutil."
          />
          <LabeledTextarea
            label="Missão"
            value={form.mission}
            onChange={(v) => setForm({ ...form, mission: v })}
            placeholder="Qual o propósito da marca?"
          />
          <LabeledTextarea
            label="Posicionamento"
            value={form.positioning}
            onChange={(v) => setForm({ ...form, positioning: v })}
            placeholder="Como a marca quer ser percebida no mercado?"
          />
          <LabeledTextarea
            label="Valores"
            rows={4}
            value={form.values}
            onChange={(v) => setForm({ ...form, values: v })}
            placeholder="Liste os valores principais (um por linha)."
          />
        </div>
      </SectionCard>
    </div>
  );
}

function FieldReadonly({
  label,
  value,
  muted,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="space-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("text-sm", muted && "text-muted-foreground")}>{value}</div>
    </div>
  );
}

function AssetSlot({
  brandId,
  clientId,
  kind,
  label,
  hint,
  currentUrl,
}: {
  brandId: string;
  clientId: string;
  kind: "logo" | "logo_secondary" | "favicon";
  label: string;
  hint: string;
  currentUrl: string | null;
}) {
  const qc = useQueryClient();
  const upload = useServerFn(uploadBrandAsset);
  const clear = useServerFn(updateBrandVisuals);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["brand-hub", brandId, clientId] });

  const handleFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) return toast.error("Arquivo deve ter até 5 MB");
    setBusy(true);
    try {
      const base64 = await fileToBase64(file);
      await upload({
        data: {
          brandId,
          clientId,
          kind,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          base64,
        },
      });
      toast.success(`${label} enviado`);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha no upload");
    } finally {
      setBusy(false);
    }
  };

  const removeAsset = async () => {
    const col =
      kind === "logo" ? "logo_url" : kind === "favicon" ? "favicon_url" : "logo_secondary_url";
    await clear({ data: { brandId, clientId, patch: { [col]: null } as never } });
    toast.success(`${label} removido`);
    invalidate();
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border/60 bg-muted/20 p-3 transition",
        dragging && "border-primary bg-primary/5",
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void handleFile(f);
      }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">{label}</div>
          <div className="truncate text-[11px] text-muted-foreground">{hint}</div>
        </div>
        {currentUrl ? (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={removeAsset}
            title="Remover"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex h-28 items-center justify-center rounded-md border border-dashed border-border bg-background transition hover:border-foreground/30"
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : currentUrl ? (
          <img src={currentUrl} alt={label} className="max-h-24 max-w-full object-contain" />
        ) : (
          <span className="px-4 text-center text-[11px] text-muted-foreground">
            <ImageIcon className="mx-auto mb-1 h-5 w-5" />
            Arraste ou clique para enviar
          </span>
        )}
      </button>
      <div className="mt-2">
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-xs"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Upload className="h-3.5 w-3.5" /> Enviar
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

/* --- Produto / Público --- */

function ProdutoTab({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <SectionCard title="Produto e oferta" hint="Detalhe o que a marca vende e como se diferencia.">
      <div className="grid gap-4 md:grid-cols-2">
        <LabeledTextarea
          label="Oferta principal"
          rows={4}
          value={form.offer}
          onChange={(v) => setForm({ ...form, offer: v })}
          placeholder="Produto/serviço principal e seus benefícios centrais."
        />
        <LabeledTextarea
          label="Faixa de preço"
          rows={4}
          value={form.price_range}
          onChange={(v) => setForm({ ...form, price_range: v })}
          placeholder="Ex.: R$ 3.000 a R$ 12.000 / mês."
        />
        <LabeledTextarea
          label="Diferenciais"
          rows={4}
          value={form.differentials}
          onChange={(v) => setForm({ ...form, differentials: v })}
          placeholder="Por que escolher essa marca e não a concorrência?"
        />
        <LabeledTextarea
          label="Objeções comuns"
          rows={4}
          value={form.objections}
          onChange={(v) => setForm({ ...form, objections: v })}
          placeholder="Principais objeções, dúvidas e barreiras de compra."
        />
      </div>
    </SectionCard>
  );
}

function PublicoTab({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <SectionCard title="Público-alvo" hint="Quem compra, o que sente e como decide.">
      <div className="grid gap-4 md:grid-cols-2">
        <LabeledTextarea
          label="Descrição do público"
          rows={4}
          value={form.audience}
          onChange={(v) => setForm({ ...form, audience: v })}
          placeholder="Perfil demográfico e comportamental do público ideal."
        />
        <LabeledTextarea
          label="Jornada do cliente"
          rows={4}
          value={form.journey}
          onChange={(v) => setForm({ ...form, journey: v })}
          placeholder="Como descobre, considera, decide e se relaciona depois da compra?"
        />
        <LabeledTextarea
          label="Dores"
          rows={4}
          value={form.pain_points}
          onChange={(v) => setForm({ ...form, pain_points: v })}
          placeholder="Principais frustrações e problemas que a marca resolve."
        />
        <LabeledTextarea
          label="Desejos"
          rows={4}
          value={form.desires}
          onChange={(v) => setForm({ ...form, desires: v })}
          placeholder="O que o público aspira ao contratar a marca."
        />
      </div>
    </SectionCard>
  );
}

/* --- Concorrentes / Estética --- */

function ConcorrentesTab({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Concorrentes" hint="@handles ou nomes para monitoramento.">
        <TagInput
          value={form.competitor_handles}
          onChange={(v) =>
            setForm({ ...form, competitor_handles: v.map((x) => x.replace(/^@/, "")) })
          }
          placeholder="@marca_concorrente — Enter para adicionar"
        />
      </SectionCard>
      <SectionCard title="Inspirações" hint="URLs de referências criativas e visuais.">
        <TagInput
          value={form.inspirations}
          onChange={(v) => setForm({ ...form, inspirations: v })}
          placeholder="https://… — Enter para adicionar"
        />
      </SectionCard>
    </div>
  );
}

function HashtagsTab({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard
        title="Hashtags estratégicas"
        hint="Pressione Enter para adicionar cada hashtag."
      >
        <TagInput
          value={form.hashtags}
          onChange={(v) =>
            setForm({
              ...form,
              hashtags: v.map((x) => (x.startsWith("#") ? x : `#${x.replace(/\s+/g, "")}`)),
            })
          }
          placeholder="#marca"
        />
      </SectionCard>

      <SectionCard title="Paleta & diretrizes visuais" hint="Cores da marca em HEX.">
        <div className="space-y-2">
          {form.palette.map((c, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-2"
            >
              <input
                type="color"
                value={c.hex}
                onChange={(e) =>
                  setForm({
                    ...form,
                    palette: form.palette.map((x, j) =>
                      i === j ? { ...x, hex: e.target.value } : x,
                    ),
                  })
                }
                className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-border bg-transparent"
              />
              <Input
                value={c.label}
                onChange={(e) =>
                  setForm({
                    ...form,
                    palette: form.palette.map((x, j) =>
                      i === j ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
                placeholder="Rótulo"
                className="h-8 text-xs"
              />
              <Input
                value={c.hex}
                onChange={(e) => {
                  const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
                  setForm({
                    ...form,
                    palette: form.palette.map((x, j) => (i === j ? { ...x, hex: v } : x)),
                  });
                }}
                maxLength={7}
                className="h-8 w-28 font-mono text-xs uppercase"
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={() =>
                  setForm({
                    ...form,
                    palette: form.palette.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() =>
              setForm({
                ...form,
                palette: [
                  ...form.palette,
                  { label: `Cor ${form.palette.length + 1}`, hex: "#6366f1" },
                ],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar cor
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <LabeledTextarea
            label="Faça"
            rows={4}
            value={form.do_text}
            onChange={(v) => setForm({ ...form, do_text: v })}
            placeholder="Diretrizes visuais e de tom que a marca deve seguir."
          />
          <LabeledTextarea
            label="Não faça"
            rows={4}
            value={form.dont_text}
            onChange={(v) => setForm({ ...form, dont_text: v })}
            placeholder="O que evitar em criação e comunicação."
          />
        </div>
      </SectionCard>
    </div>
  );
}

/* --- Volumetria --- */

function VolumetriaTab({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const [extra, setExtra] = useState<SocialKey[]>([]);
  const basis = form.volumetry_basis;
  const maxQty = volumetryMax(basis);
  const weeksInMonth = useMemo(() => {
    const now = new Date();
    return getWeeksInMonth(now.getFullYear(), now.getMonth());
  }, []);
  const visible = SOCIALS.filter(
    ({ key }) =>
      PLAN_CHANNELS_DEFAULT.includes(key) || (form.volumetry[key] ?? 0) > 0 || extra.includes(key),
  );
  const hidden = SOCIALS.filter((s) => !visible.some((v) => v.key === s.key));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard
        title={basis === "monthly" ? "Volume mensal por canal" : "Volume semanal por canal"}
        hint={
          basis === "monthly"
            ? "Meta de publicações por mês. A pauta respeita estes limites."
            : "Meta de publicações por semana. A pauta respeita estes limites."
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="text-xs text-muted-foreground">Base do volume</span>
          <div className="ml-auto flex items-center gap-1">
            {(["weekly", "monthly"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setForm({ ...form, volumetry_basis: b })}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                  basis === b
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {b === "weekly" ? "Por semana" : "Por mês"}
              </button>
            ))}
          </div>
        </div>
        {hidden.length > 0 && (
          <div className="mb-2 flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Canais
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {hidden.map(({ key, label }) => (
                  <DropdownMenuItem key={key} onClick={() => setExtra((p) => [...p, key])}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <div className="divide-y divide-border/60">
          {visible.map(({ key, label }) => {
            const bucket = form.volumetry_breakdown[key] ?? {};
            const value = sumChannelBreakdown(bucket);
            const on = value > 0;
            const meta = CHANNELS.find((c) => c.id === key);
            const Icon = meta?.icon;
            const available = formatsForChannel(key);
            const patchBucket = (next: Partial<Record<ContentFormat, number>>) => {
              const cleaned: Partial<Record<ContentFormat, number>> = {};
              for (const f of CONTENT_FORMATS) {
                const n = Math.max(0, Math.min(maxQty, Math.round(next[f] ?? 0)));
                if (n > 0) cleaned[f] = n;
              }
              setForm({
                ...form,
                volumetry_breakdown: { ...form.volumetry_breakdown, [key]: cleaned },
                // Total do canal = soma dos formatos (mantido para compatibilidade).
                volumetry: { ...form.volumetry, [key]: sumChannelBreakdown(cleaned) },
                // `formats` continua refletindo os formatos com volume > 0.
                formats: {
                  ...form.formats,
                  [key]: CONTENT_FORMATS.filter((f) => (cleaned[f] ?? 0) > 0),
                },
              });
            };
            const setFormatQty = (f: ContentFormat, n: number) =>
              patchBucket({ ...bucket, [f]: n });
            const toggleOn = (v: boolean) => {
              if (!v) return patchBucket({});
              const first = available[0];
              if (!first) return;
              patchBucket({ [first]: basis === "monthly" ? 4 : 1 });
            };
            return (
              <div key={key} className={cn("py-2 transition-opacity", !on && "opacity-60")}>
                <div
                  className="flex h-8 items-center gap-2.5"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("[data-stepper]")) return;
                    toggleOn(!on);
                  }}
                  role="button"
                >
                  <Checkbox
                    className="h-3.5 w-3.5"
                    checked={on}
                    onCheckedChange={(v) => toggleOn(Boolean(v))}
                    aria-label={`Incluir ${label}`}
                  />
                  <span
                    className={cn(
                      "inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] font-medium uppercase tracking-wider",
                      CHANNEL_STYLES[key] ?? "border-border/60 bg-muted/40 text-foreground/80",
                    )}
                  >
                    {Icon ? <Icon className="h-2.5 w-2.5" /> : null}
                    {label}
                  </span>
                  <span className="ml-auto text-[11px] font-semibold tabular-nums text-foreground/80">
                    {value} {basis === "monthly" ? "/ mês" : "/ sem"}
                  </span>
                </div>
                {on && (
                  <p className="mt-1 pl-6 text-[11px] text-muted-foreground tabular-nums">
                    {basis === "monthly"
                      ? `≈ ${resolveQuota(value, basis, weeksInMonth).perWeek}/semana`
                      : `= ${resolveQuota(value, basis, weeksInMonth).perMonth}/mês (${weeksInMonth} semanas)`}
                  </p>
                )}
                {on && available.length > 0 && (
                  <div className="mt-1.5 space-y-1 pl-6">
                    <span className="text-[11px] text-muted-foreground">
                      Volumetria por formato
                    </span>
                    {available.map((f) => (
                      <div
                        key={f}
                        className="flex h-7 items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-2"
                      >
                        <span className="text-[11px] font-medium text-foreground/80">
                          {CONTENT_FORMAT_LABEL[f]}
                        </span>
                        <Stepper
                          className="ml-auto"
                          value={bucket[f] ?? 0}
                          onChange={(n) => setFormatQty(f, n)}
                          min={0}
                          max={maxQty}
                          suffix={basis === "monthly" ? "/ mês" : "/ sem"}
                          label={`${label} ${CONTENT_FORMAT_LABEL[f]}`}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Metas & restrições" hint="Objetivos de negócio e limitações.">
        <LabeledTextarea
          label="Metas e restrições"
          rows={14}
          value={form.goals}
          onChange={(v) => setForm({ ...form, goals: v })}
          placeholder="Ex.: meta de leads/mês, temas sensíveis, aprovações jurídicas, blackout de campanhas."
        />
      </SectionCard>
    </div>
  );
}

/* ------------------------- Stacked (single-page) layout ------------------------- */

const BRAIN_SECTIONS = [
  { id: "identidade", label: "Identidade" },
  { id: "produto", label: "Produto" },
  { id: "publico", label: "Público" },
  { id: "concorrentes", label: "Concorrentes" },
  { id: "estetica", label: "Estética" },
  { id: "metas", label: "Metas" },
  { id: "documentos", label: "Documentos & Contexto IA" },
] as const;

type EssentialField = {
  key: "tone_text" | "mission" | "positioning" | "offer" | "audience";
  label: string;
  sectionId: string;
};

const ESSENTIAL_FIELDS: EssentialField[] = [
  { key: "tone_text", label: "Tom de voz", sectionId: "identidade" },
  { key: "mission", label: "Missão", sectionId: "identidade" },
  { key: "positioning", label: "Posicionamento", sectionId: "identidade" },
  { key: "offer", label: "Oferta principal", sectionId: "produto" },
  { key: "audience", label: "Descrição do público", sectionId: "publico" },
];

function getMissingEssentials(form: FormState): EssentialField[] {
  return ESSENTIAL_FIELDS.filter(
    (f) => !((form as unknown as Record<string, string | undefined>)[f.key] ?? "").trim(),
  );
}

/**
 * Ação de IA única e contextual. Reúne importar contexto, gerar inteligência e
 * gerar ideias em um só ponto de entrada, com aviso de campos essenciais
 * faltantes em vez de um popover separado.
 */
function AiActionsMenu({
  form,
  generating,
  genIdeas,
  strategyReady,
  onGenerateStrategy,
  onGenerateIdeas,
  onImportAi,
  onJump,
}: {
  form: FormState;
  generating: boolean;
  genIdeas: boolean;
  strategyReady: boolean;
  onGenerateStrategy: () => void;
  onGenerateIdeas: () => void;
  onImportAi: () => void;
  onJump: (sectionId: string) => void;
}) {
  const missing = getMissingEssentials(form);
  const busy = generating || genIdeas;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 text-xs text-muted-foreground"
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          IA
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          Gerar com IA
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={onGenerateStrategy} className="gap-2">
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-xs font-medium">Gerar inteligência</span>
            <span className="block text-[11px] text-muted-foreground">
              Voice Card, personas, cohorts e SWOT
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onGenerateIdeas}
          disabled={!strategyReady}
          className="gap-2"
        >
          <Lightbulb className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="block text-xs font-medium">Gerar ideias de conteúdo</span>
            <span className="block text-[11px] text-muted-foreground">
              {strategyReady ? "A partir da estratégia revisada" : "Gere a estratégia primeiro"}
            </span>
          </span>
        </DropdownMenuItem>
        {missing.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                Campos essenciais em falta melhoram o resultado da IA:
              </p>
              <div className="flex flex-wrap gap-1">
                {missing.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => onJump(f.sectionId)}
                    className="rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}


type StackedProps = {
  brandId: string;
  clientId: string;
  client: BrandHubClient;
  form: FormState;
  setForm: (f: FormState) => void;
  completion: number;
  onSave: () => void;
  saving: boolean;
  savedAt: string | null;
  onGenerateStrategy: () => void;
  onGenerateIdeas: () => void;
  onImportAi: () => void;
  strategyReady: boolean;
  generating: boolean;
  genIdeas: boolean;
  appendSlot?: React.ReactNode;
  regenOpen: boolean;
  setRegenOpen: (v: boolean) => void;
  runStrategy: () => Promise<void> | void;
  ideasOpen: boolean;
  setIdeasOpen: (v: boolean) => void;
  ideasTheme: string;
  setIdeasTheme: (v: string) => void;
  ideasOrg: OrganizationDraft;
  setIdeasOrg: (v: OrganizationDraft) => void;
  runIdeas: () => Promise<void> | void;
};

function StackedBrainLayout(props: StackedProps) {
  const {
    brandId,
    clientId,
    client,
    form,
    setForm,
    completion,
    onSave,
    saving,
    savedAt,
    onGenerateStrategy,
    onGenerateIdeas,
    onImportAi,
    strategyReady,
    generating,
    appendSlot,
    regenOpen,
    setRegenOpen,
    runStrategy,
    ideasOpen,
    setIdeasOpen,
    ideasTheme,
    setIdeasTheme,
    ideasOrg,
    setIdeasOrg,
    genIdeas,
    runIdeas,
  } = props;
  const [active, setActive] = useState<string>(BRAIN_SECTIONS[0].id);

  useEffect(() => {
    const els = BRAIN_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      Boolean,
    ) as HTMLElement[];
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target?.id) setActive(visible.target.id);
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative">
      {/* Header minimalista: marca + progresso/salvamento + salvar + uma ação de IA */}
      <div className="sticky top-0 z-20 -mx-1 border-b border-border/60 bg-background/85 px-1 py-3 backdrop-blur-md">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold tracking-tight">
                {client.name ?? "Briefing"}
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {savedAt
                  ? `Salvo em ${new Intl.DateTimeFormat("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(savedAt))}`
                  : "Ainda não salvo nesta sessão"}
              </p>
            </div>
            <div className="hidden w-40 shrink-0 md:block">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="truncate">{progressLabel(completion)}</span>
                <span className="font-mono">{completion}%</span>
              </div>
              <Progress value={completion} className="h-1.5" />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              className="h-9 gap-1.5 px-4 text-sm font-medium shadow-sm"
              onClick={onImportAi}
            >
              <Sparkles className="h-4 w-4" />
              Importar com IA
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-9 gap-1.5 px-3.5 text-sm"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Salvar
            </Button>
            <AiActionsMenu
              form={form}
              generating={generating}
              genIdeas={genIdeas}
              strategyReady={strategyReady}
              onGenerateStrategy={onGenerateStrategy}
              onGenerateIdeas={onGenerateIdeas}
              onImportAi={onImportAi}
              onJump={scrollTo}
            />
          </div>
        </div>
        <div className="mt-2 md:hidden">
          <Progress value={completion} className="h-1.5" />
        </div>
      </div>


      <div className="grid gap-8 pt-6 md:grid-cols-[200px_minmax(0,1fr)]">
        {/* Left anchor nav */}
        <aside className="hidden md:block">
          <nav className="sticky top-24 space-y-1">
            <div className="mb-2 px-3 text-[11px] text-muted-foreground">Cérebro</div>
            {BRAIN_SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                className={cn(
                  "block w-full rounded-md px-3 py-1.5 text-left text-xs transition",
                  active === s.id
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Stacked content */}
        <div className="min-w-0 space-y-10 pb-24">
          <BrainSection id="identidade" title="Identidade">
            <IdentidadeTab
              brandId={brandId}
              clientId={clientId}
              client={client}
              form={form}
              setForm={setForm}
            />
          </BrainSection>

          <BrainSection id="produto" title="Produto & Oferta">
            <ProdutoTab form={form} setForm={setForm} />
          </BrainSection>

          <BrainSection id="publico" title="Público-alvo">
            <PublicoTab form={form} setForm={setForm} />
          </BrainSection>

          <BrainSection id="concorrentes" title="Concorrentes & Inspirações">
            <ConcorrentesTab form={form} setForm={setForm} />
          </BrainSection>

          <BrainSection id="estetica" title="Estética & Hashtags">
            <HashtagsTab form={form} setForm={setForm} />
          </BrainSection>

          <BrainSection id="metas" title="Volumetria & Metas">
            <VolumetriaTab form={form} setForm={setForm} />
          </BrainSection>

          <BrainSection id="documentos" title="Documentos & Contexto IA">
            <div className="space-y-4">
              <DocumentsTab brandId={brandId} clientId={clientId} onImportAi={onImportAi} />
              <BriefingImportHistory brandId={brandId} clientId={clientId} />
            </div>
          </BrainSection>



          <BrainSection id="briefing-cliente" title="Briefing com o cliente">
            <BriefingRequestPanel brandId={brandId} clientId={clientId} />
          </BrainSection>

          {appendSlot ? <div className="space-y-10 pt-4">{appendSlot}</div> : null}
        </div>
      </div>

      <AlertDialog open={regenOpen} onOpenChange={setRegenOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Gerar inteligência com IA?</AlertDialogTitle>
            <AlertDialogDescription>
              Os agentes vão ler o briefing e gerar Voice Card, Personas, Cohorts e SWOT. O processo
              roda em segundo plano.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runStrategy();
              }}
              disabled={generating}
            >
              {generating ? "Iniciando…" : "Gerar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={ideasOpen} onOpenChange={setIdeasOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar ideias de conteúdo</DialogTitle>
            <DialogDescription>
              Pautas geradas a partir da estratégia revisada, distribuídas por canal e agendadas no
              calendário respeitando a volumetria do briefing (canal + formato + quantidade).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ideas-theme-stacked">Tema do mês (opcional)</Label>
              <Input
                id="ideas-theme-stacked"
                placeholder="Ex.: lançamento da coleção de verão"
                value={ideasTheme}
                onChange={(e) => setIdeasTheme(e.target.value)}
              />
            </div>
            <PautaOrganizationField
              brandId={brandId}
              clientId={clientId}
              value={ideasOrg}
              onChange={setIdeasOrg}
              allowNone={false}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIdeasOpen(false)} disabled={genIdeas}>
              Cancelar
            </Button>
            <Button
              onClick={() => void runIdeas()}
              disabled={genIdeas || !toOrganizationInput(ideasOrg, false)} className="gap-1.5">
              {genIdeas ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lightbulb className="h-3.5 w-3.5" />
              )}
              {genIdeas ? "Iniciando…" : "Gerar ideias"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BrainSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h3 className="text-base font-medium tracking-tight">{title}</h3>
      {children}
    </section>
  );
}
