import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Coins,
  Cpu,
  DollarSign,
  KeyRound,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { supportsKind, type ProviderName as AiProviderName } from "@/lib/ai-capabilities";
import { getAiModelStatus, runAiModelHealthNow } from "@/lib/ai-models.functions";
import { saveProviderKey, testProviderKey, removeProviderKey } from "@/lib/connections.functions";
import { cn } from "@/lib/utils";

export type AiProviderId = "openai" | "anthropic" | "gemini" | "groq";

type ProviderDef = {
  id: AiProviderId;
  name: string;
  hint: string;
  tone: string;
  docs: string;
  icon: ComponentType<{ className?: string }>;
  models: Array<{ id: string; label: string; kind: "text" | "image" }>;
};

export const AI_PROVIDERS: ProviderDef[] = [
  {
    id: "openai",
    name: "OpenAI",
    hint: "GPT-5 · GPT-5 mini · GPT-Image",
    tone: "text-emerald-500",
    docs: "platform.openai.com",
    icon: Sparkles,
    models: [
      { id: "gpt-5", label: "GPT-5", kind: "text" },
      { id: "gpt-5-mini", label: "GPT-5 mini", kind: "text" },
      { id: "gpt-image-1", label: "GPT Image 1", kind: "image" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    hint: "Claude Sonnet · Claude Opus",
    tone: "text-amber-500",
    docs: "console.anthropic.com",
    icon: Brain,
    models: [
      { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", kind: "text" },
      { id: "claude-opus-4.1", label: "Claude Opus 4.1", kind: "text" },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    hint: "Gemini · Imagen",
    tone: "text-sky-500",
    docs: "aistudio.google.com",
    icon: Cpu,
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", kind: "text" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", kind: "text" },
      { id: "imagen-4", label: "Imagen 4", kind: "image" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    hint: "Llama · GPT-OSS",
    tone: "text-orange-500",
    docs: "console.groq.com",
    icon: Zap,
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", kind: "text" },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", kind: "text" },
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", kind: "text" },
    ],
  },
];

const PROVIDER_BY_ID = Object.fromEntries(AI_PROVIDERS.map((p) => [p.id, p])) as Record<
  AiProviderId,
  ProviderDef
>;

type ProviderConfig = {
  connected: boolean;
  masked?: string;
  updatedAt?: string;
  verified?: "valid" | "invalid" | "unverified";
  verifiedAt?: string;
  verifyMessage?: string;
};

export type AiCenterData = {
  monthlyBudgetUsd?: number;
  textProvider?: AiProviderId;
  imageProvider?: AiProviderId;
  textFallbackProvider?: AiProviderId | "none";
  providers?: Partial<Record<AiProviderId, ProviderConfig>>;
  usage: {
    monthUsd: number;
    monthTokens: number;
    totalCalls: number;
    successCalls: number;
    byProvider?: Record<string, { usd: number; tokens: number; calls: number }>;
  };
};

export type AiSettingsUpdate = {
  monthlyBudgetUsd?: number;
  textProvider?: AiProviderId;
  imageProvider?: AiProviderId;
  textFallbackProvider?: AiProviderId | "none";
};

/**
 * Central de IA — apresentação apenas. Todas as regras (chaves, consumo,
 * fallback, custo) continuam nas server functions já existentes.
 */
export function AiCenter({
  brandId,
  data,
  isLoading,
  onChanged,
  onUpdateSettings,
  isSaving,
}: {
  brandId: string;
  data: AiCenterData | undefined;
  isLoading: boolean;
  onChanged: () => void;
  onUpdateSettings: (input: AiSettingsUpdate) => void;
  isSaving: boolean;
}) {
  const [tab, setTab] = useState("overview");

  const budget = data?.monthlyBudgetUsd ?? 500;
  const used = data?.usage.monthUsd ?? 0;
  const pct = Math.min(100, Math.round((used / (budget || 1)) * 100));
  const totalCalls = data?.usage.totalCalls ?? 0;
  const successCalls = data?.usage.successCalls ?? 0;
  const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
  const noUsage = !isLoading && totalCalls === 0;
  const byProvider = data?.usage.byProvider ?? {};

  const textProvider = (data?.textProvider ?? "openai") as AiProviderId;
  const imageProvider = (data?.imageProvider ?? "gemini") as AiProviderId;
  const fallback = (data?.textFallbackProvider ?? "none") as AiProviderId | "none";

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList variant="bordered">
        <TabsTrigger value="overview">Visão geral</TabsTrigger>
        <TabsTrigger value="providers">Provedores</TabsTrigger>
        <TabsTrigger value="models">Modelos</TabsTrigger>
        <TabsTrigger value="config">Configuração</TabsTrigger>
      </TabsList>

      {/* ------------------------------- Visão geral ------------------------ */}
      <TabsContent value="overview" className="space-y-4">
        <PageKpiGrid columns={4}>
          <PageKpi
            icon={<DollarSign />}
            label="Consumo no mês"
            value={isLoading ? "—" : `$${used.toFixed(2)}`}
            description={
              noUsage
                ? "Sem chamadas registradas neste mês"
                : `de $${budget.toFixed(0)} · ${pct}% do limite`
            }
            status={noUsage ? "neutral" : pct >= 80 ? "warning" : "success"}
            trailing="USD"
          />
          <PageKpi
            icon={<Coins />}
            label="Tokens utilizados"
            value={isLoading ? "—" : (data?.usage.monthTokens ?? 0).toLocaleString("pt-BR")}
            description={noUsage ? "Nenhum token consumido ainda" : "Entrada + saída"}
            status={noUsage ? "neutral" : "info"}
          />
          <PageKpi
            icon={<Activity />}
            label="Chamadas de IA"
            value={isLoading ? "—" : totalCalls.toLocaleString("pt-BR")}
            description={noUsage ? "Aguardando a primeira geração" : `${successCalls} com sucesso`}
            status={noUsage ? "neutral" : "info"}
          />
          <PageKpi
            icon={<CheckCircle2 />}
            label="Taxa de sucesso"
            value={noUsage ? "—" : `${successRate}%`}
            description={noUsage ? "Sem histórico no mês" : "Chamadas concluídas sem erro"}
            status={
              noUsage
                ? "neutral"
                : successRate >= 95
                  ? "success"
                  : successRate >= 80
                    ? "warning"
                    : "danger"
            }
          />
        </PageKpiGrid>

        <DashboardPanelSurface className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Configuração atual</div>
              <p className="text-xs text-muted-foreground">
                Modelos e limite usados por todo o workspace.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setTab("config")}>
              <Settings2 className="mr-2 h-3.5 w-3.5" />
              Editar configuração
            </Button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryRow label="Modelo de texto" value={PROVIDER_BY_ID[textProvider]?.name} />
            <SummaryRow label="Modelo de imagem" value={PROVIDER_BY_ID[imageProvider]?.name} />
            <SummaryRow
              label="Fallback"
              value={fallback === "none" ? "Nenhum" : PROVIDER_BY_ID[fallback]?.name}
            />
            <SummaryRow label="Limite mensal" value={`US$ ${budget.toFixed(0)}`} />
          </div>
        </DashboardPanelSurface>

        <HealthPanel brandId={brandId} providers={data?.providers} />
      </TabsContent>

      {/* -------------------------------- Provedores ------------------------ */}
      <TabsContent value="providers" className="space-y-3">
        <div>
          <div className="text-sm font-semibold">Provedores de IA</div>
          <p className="text-xs text-muted-foreground">
            Conecte os provedores que o Unitos poderá utilizar.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {AI_PROVIDERS.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              config={data?.providers?.[p.id]}
              brandId={brandId}
              onChanged={onChanged}
              usage={byProvider[p.id] ?? { usd: 0, tokens: 0, calls: 0 }}
            />
          ))}
        </div>
      </TabsContent>

      {/* --------------------------------- Modelos -------------------------- */}
      <TabsContent value="models" className="space-y-3">
        <div>
          <div className="text-sm font-semibold">Modelos disponíveis</div>
          <p className="text-xs text-muted-foreground">
            Organizados por provedor, com a função de cada modelo.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {AI_PROVIDERS.map((p) => {
            const connected = !!data?.providers?.[p.id]?.connected;
            return (
              <DashboardPanelSurface key={p.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <p.icon className={cn("h-4 w-4", p.tone)} />
                    <span className="text-xs font-semibold">{p.name}</span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-widest",
                      connected ? "text-health-good" : "text-muted-foreground",
                    )}
                  >
                    {connected ? "Conectado" : "Não conectado"}
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {p.models.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-foreground/90">{m.label}</span>
                      <Badge variant="outline" className="shrink-0 text-[9px] uppercase">
                        {m.kind === "image" ? "Imagem" : "Texto"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </DashboardPanelSurface>
            );
          })}
        </div>
      </TabsContent>

      {/* ----------------------------- Configuração ------------------------- */}
      <TabsContent value="config" className="space-y-3">
        <ConfigForm
          textProvider={textProvider}
          imageProvider={imageProvider}
          fallback={fallback}
          budget={budget}
          isSaving={isSaving}
          onSave={onUpdateSettings}
        />
      </TabsContent>
    </Tabs>
  );
}

/* -------------------------------------------------------------------------- */

function SummaryRow({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium">{value ?? "—"}</div>
    </div>
  );
}

function ConfigForm({
  textProvider,
  imageProvider,
  fallback,
  budget,
  isSaving,
  onSave,
}: {
  textProvider: AiProviderId;
  imageProvider: AiProviderId;
  fallback: AiProviderId | "none";
  budget: number;
  isSaving: boolean;
  onSave: (input: AiSettingsUpdate) => void;
}) {
  const [text, setText] = useState<AiProviderId>(textProvider);
  const [image, setImage] = useState<AiProviderId>(imageProvider);
  const [fb, setFb] = useState<AiProviderId | "none">(fallback);
  const [limit, setLimit] = useState<string>(String(budget));

  useEffect(() => {
    setText(textProvider);
    setImage(imageProvider);
    setFb(fallback);
    setLimit(String(budget));
  }, [textProvider, imageProvider, fallback, budget]);

  const textOptions = AI_PROVIDERS.filter((p) => supportsKind(p.id as AiProviderName, "text"));
  const imageOptions = AI_PROVIDERS.filter((p) => supportsKind(p.id as AiProviderName, "image"));
  const fallbackOptions = textOptions.filter((p) => p.id !== text);

  return (
    <DashboardPanelSurface className="p-4">
      <div>
        <div className="text-sm font-semibold">Configuração de uso</div>
        <p className="text-xs text-muted-foreground">
          Define quais provedores o Unitos usa e quanto pode gastar por mês.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Modelo de texto padrão">
          <Select value={text} onValueChange={(v) => setText(v as AiProviderId)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {textOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Modelo de imagem padrão">
          <Select value={image} onValueChange={(v) => setImage(v as AiProviderId)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {imageOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Modelo de fallback" hint="Usado apenas quando o provedor principal falha.">
          <Select value={fb} onValueChange={(v) => setFb(v as AiProviderId | "none")}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nenhum</SelectItem>
              {fallbackOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Limite mensal (USD)">
          <Input
            type="number"
            min={0}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="h-9 tabular-nums"
          />
        </Field>
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          disabled={isSaving}
          onClick={() => {
            const n = Number(limit);
            const payload: AiSettingsUpdate = {
              textProvider: text,
              imageProvider: image,
              textFallbackProvider: fb,
            };
            if (Number.isFinite(n) && n >= 0) payload.monthlyBudgetUsd = n;
            onSave(payload);
          }}
        >
          Salvar configuração
        </Button>
      </div>
    </DashboardPanelSurface>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HealthPanel({
  brandId,
  providers,
}: {
  brandId: string;
  providers: Partial<Record<AiProviderId, ProviderConfig>> | undefined;
}) {
  const statusFn = useServerFn(getAiModelStatus);
  const runFn = useServerFn(runAiModelHealthNow);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["ai-model-status", brandId],
    queryFn: () => statusFn(),
    staleTime: 5 * 60 * 1000,
  });

  const runMut = useMutation({
    mutationFn: () => runFn(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["ai-model-status", brandId] });
      toast.success(
        res.replacements > 0
          ? `${res.replacements} modelo(s) atualizado(s) automaticamente`
          : res.problems > 0
            ? `${res.problems} verificação(ões) com problema — veja as notificações`
            : "Todos os modelos estão ativos",
      );
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Falha ao verificar modelos"),
  });

  const connectedProviders = AI_PROVIDERS.filter((p) => providers?.[p.id]?.connected);
  const replaced = (data?.models ?? []).filter((m) => m.replacedModelId);

  return (
    <DashboardPanelSurface className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Saúde da IA</div>
          <p className="text-xs text-muted-foreground">
            {data?.lastCheckedAt
              ? `Última verificação: ${new Date(data.lastCheckedAt).toLocaleString("pt-BR")}`
              : "Nunca verificado"}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
        >
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", runMut.isPending && "animate-spin")} />
          Verificar agora
        </Button>
      </div>

      {connectedProviders.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Nenhum provedor conectado ainda.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {connectedProviders.map((p) => {
            const c = providers?.[p.id];
            const ok = c?.verified === "valid";
            const bad = c?.verified === "invalid";
            return (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        ok
                          ? "bg-health-good"
                          : bad
                            ? "bg-severity-critical"
                            : "bg-severity-warning",
                      )}
                    />
                    {p.name}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {ok ? "Chave válida" : bad ? "Chave inválida" : "Chave não verificada"}
                    {c?.verifiedAt ? ` · ${new Date(c.verifiedAt).toLocaleString("pt-BR")}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {replaced.length > 0 && (
        <div className="mt-3 space-y-1">
          {replaced.map((m) => (
            <div
              key={`${m.provider}-${m.role}`}
              className="flex items-center gap-1.5 text-[11px] text-severity-warning"
            >
              <AlertTriangle className="h-3 w-3" />
              {m.provider}: {m.modelId} substituiu {m.replacedModelId}
            </div>
          ))}
        </div>
      )}
    </DashboardPanelSurface>
  );
}

/* -------------------------------------------------------------------------- */

function ProviderCard({
  provider,
  config,
  brandId,
  onChanged,
  usage,
}: {
  provider: ProviderDef;
  config?: ProviderConfig;
  brandId: string;
  onChanged: () => void;
  usage: { usd: number; tokens: number; calls: number };
}) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<string>(provider.models[0]?.id ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveFn = useServerFn(saveProviderKey);
  const removeFn = useServerFn(removeProviderKey);
  const testFn = useServerFn(testProviderKey);

  const saveMut = useMutation({
    mutationFn: () => saveFn({ data: { brandId, provider: provider.id, apiKey: apiKey.trim() } }),
    onSuccess: (res) => {
      if (res.verified === "valid") toast.success(`${provider.name} conectado — chave válida`);
      else toast.warning(res.message);
      setApiKey("");
      setSaveError(null);
      setOpen(false);
      onChanged();
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Falha ao conectar";
      setSaveError(msg);
      toast.error(msg);
    },
  });

  const testMut = useMutation({
    mutationFn: () => testFn({ data: { brandId, provider: provider.id } }),
    onSuccess: (res) => {
      if (res.status === "valid") toast.success(res.message);
      else if (res.status === "invalid") toast.error(res.message);
      else toast.warning(res.message);
      onChanged();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Falha ao testar a chave"),
  });

  const removeMut = useMutation({
    mutationFn: () => removeFn({ data: { brandId, provider: provider.id } }),
    onSuccess: () => {
      toast.success(`${provider.name} desconectado`);
      onChanged();
    },
  });

  const connected = !!config?.connected;
  const Icon = provider.icon;

  return (
    <DashboardPanelSurface className="flex flex-col p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/60",
              provider.tone,
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{provider.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">{provider.hint}</div>
          </div>
        </div>
        <ProviderStatus connected={connected} verified={config?.verified} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Modelo padrão
        </span>
        <Select value={model} onValueChange={setModel} disabled={!connected}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder="Selecionar" />
          </SelectTrigger>
          <SelectContent>
            {provider.models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
        {connected ? (
          <>
            <div className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <KeyRound className="h-3 w-3" />
                API Key
              </span>
              <span className="tabular-nums text-foreground/80">{config?.masked ?? "••••"}</span>
            </div>
            <div
              className={cn(
                "mt-1 text-[11px]",
                config?.verified === "valid"
                  ? "text-health-good"
                  : config?.verified === "invalid"
                    ? "text-severity-critical"
                    : "text-severity-warning",
              )}
            >
              {config?.verified === "valid"
                ? "Chave válida"
                : config?.verified === "invalid"
                  ? "Chave inválida"
                  : "Chave não verificada"}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            Obtenha a chave em {provider.docs}
          </div>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Tokens este mês{" "}
          <span className="font-medium tabular-nums text-foreground/90">
            {usage.tokens.toLocaleString("pt-BR")}
          </span>
        </span>
        <span>
          Custo{" "}
          <span className="font-medium tabular-nums text-foreground/90">
            ${usage.usd.toFixed(2)}
          </span>
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        {connected ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => testMut.mutate()}
              disabled={testMut.isPending}
            >
              <RefreshCw className={cn("mr-2 h-3.5 w-3.5", testMut.isPending && "animate-spin")} />
              Testar
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setOpen(true)}>
              Rotacionar chave
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => removeMut.mutate()}
              disabled={removeMut.isPending}
              aria-label={`Remover ${provider.name}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Button size="sm" className="flex-1" onClick={() => setOpen(true)}>
            Conectar
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar {provider.name}</DialogTitle>
            <DialogDescription>
              A chave é testada antes de ser salva e fica armazenada de forma cifrada. Apenas os
              últimos 4 caracteres ficam visíveis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`key-${provider.id}`}>API Key</Label>
            <PasswordInput
              id={`key-${provider.id}`}
              autoComplete="off"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setSaveError(null);
              }}
            />
            {saveError && (
              <p className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {saveError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || apiKey.trim().length < 8}
            >
              {saveMut.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              {saveMut.isPending ? "Testando chave…" : "Testar e salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardPanelSurface>
  );
}

function ProviderStatus({
  connected,
  verified,
}: {
  connected: boolean;
  verified?: ProviderConfig["verified"];
}) {
  if (!connected) {
    return (
      <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
        Não conectado
      </Badge>
    );
  }
  if (verified === "invalid") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-severity-critical/30 text-[10px] text-severity-critical"
      >
        Problema
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-health-good/30 text-[10px] text-health-good"
    >
      Conectado
    </Badge>
  );
}
