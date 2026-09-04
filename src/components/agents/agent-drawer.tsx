import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Play,
  Circle,
  RotateCcw,
  Save,
  Eye,
  Pencil,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import type { AgentPromptRow } from "@/lib/agents.functions";
import {
  updateAgentPromptFn,
  resetAgentPromptFn,
  runAgentPlaygroundFn,
} from "@/lib/agents.functions";
import { getAgentMeta, toTitleCase } from "./agent-meta";
import {
  AGENT_VARIABLE_CATALOG,
  CATEGORY_LABEL,
  extractPromptVariables,
  type ResolvedVariableMap,
} from "@/lib/agent-variables";
import { resolveAgentVariablesFn } from "@/lib/agent-variables.functions";

const MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-pro",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4",
];

type Props = {
  agent: AgentPromptRow | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string | null;
  clientId: string | null;
};

export function AgentDrawer({ agent, open, onOpenChange, brandId, clientId }: Props) {
  const [model, setModel] = useState<string>("google/gemini-2.5-flash");
  const [active, setActive] = useState(true);
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");

  const qc = useQueryClient();
  const updateFn = useServerFn(updateAgentPromptFn);
  const resetFn = useServerFn(resetAgentPromptFn);
  const runFn = useServerFn(runAgentPlaygroundFn);
  const resolveFn = useServerFn(resolveAgentVariablesFn);

  const resolvedQuery = useQuery({
    enabled: open && !!brandId && !!clientId,
    queryKey: ["agent-variables", brandId, clientId],
    queryFn: () => resolveFn({ data: { brandId: brandId!, clientId: clientId! } }),
    staleTime: 60_000,
  });
  const resolved: ResolvedVariableMap = resolvedQuery.data ?? {};

  const vars = useMemo(
    () =>
      agent ? extractPromptVariables(editing ? draftPrompt : (agent.override_prompt ?? "")) : [],
    [agent, editing, draftPrompt],
  );

  useEffect(() => {
    setTestOutput(null);
    setTestInput("");
    setEditing(false);
    setDraftPrompt(agent?.override_prompt ?? "");
    setOverrides({});
  }, [agent]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!agent || !brandId) return;
      await updateFn({
        data: { brandId, agentId: agent.agent_id, systemPrompt: draftPrompt },
      });
    },
    onSuccess: () => {
      toast.success("Prompt customizado salvo para esta marca.");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["agent-prompts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!agent || !brandId) return null;
      return await resetFn({ data: { brandId, agentId: agent.agent_id } });
    },
    onSuccess: () => {
      setDraftPrompt("");
      toast.success("Prompt customizado removido. O agente voltou ao padrão privado da Unitos.");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["agent-prompts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      if (!agent || !brandId) return null;
      const values: Record<string, string> = {};
      for (const key of vars) {
        if (overrides[key]) values[key] = overrides[key];
        else if (resolved[key]?.value) values[key] = resolved[key].value;
      }
      return await runFn({
        data: {
          brandId,
          agentId: agent.agent_id,
          userInput: testInput,
          variables: values,
          model,
        },
      });
    },
    onSuccess: (res) => {
      if (!res) return;
      setTestOutput(`// ${res.model} · ${res.ms}ms\n\n${res.output || "(sem resposta)"}`);
    },
    onError: (e: Error) => {
      setTestOutput(`// erro\n${e.message}`);
      toast.error(e.message);
    },
  });

  if (!agent) return null;
  const meta = getAgentMeta(agent.agent_id, agent.agent_name);
  const Icon = meta.icon;
  const currentPrompt = agent.override_prompt ?? "";
  const isDirty = draftPrompt !== currentPrompt;
  const isCustomized = agent.has_override;
  const testing = runMutation.isPending;
  const unresolvedCount = vars.filter(
    (v) =>
      AGENT_VARIABLE_CATALOG[v] &&
      !AGENT_VARIABLE_CATALOG[v].runtimeProvided &&
      !resolved[v]?.resolved,
  ).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-5">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${meta.iconClass}`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-base">
                {toTitleCase(agent.agent_name)}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {meta.categoryLabel} · atualizado em{" "}
                {new Date(agent.updated_at).toLocaleDateString("pt-BR")}
              </SheetDescription>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActive((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
            >
              <Circle
                className={`h-2 w-2 ${
                  active
                    ? "fill-emerald-500 text-emerald-500"
                    : "fill-muted-foreground text-muted-foreground"
                }`}
              />
              {active ? "Ativo" : "Inativo"}
            </button>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="h-7 w-auto gap-2 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge
              variant="secondary"
              className="h-5 rounded-md px-1.5 font-mono text-[10px] font-normal"
            >
              {agent.agent_id}
            </Badge>
          </div>
        </SheetHeader>

        <Tabs defaultValue="prompt" className="flex flex-1 flex-col overflow-hidden">
          <TabsList variant="grid" className="mx-5 mt-3 grid w-[calc(100%-2.5rem)] grid-cols-3">
            <TabsTrigger value="prompt">Prompt</TabsTrigger>
            <TabsTrigger value="variables">
              Variáveis {vars.length ? `(${vars.length})` : ""}
              {unresolvedCount > 0 && (
                <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                  {unresolvedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="playground">Playground</TabsTrigger>
          </TabsList>

          <TabsContent value="prompt" className="flex-1 overflow-hidden p-5 pt-3">
            <div className="flex h-full flex-col">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">
                  Prompt customizado da marca · variáveis em <code>{"{{VAR}}"}</code> são destacadas
                  {isCustomized ? (
                    <Badge
                      variant="outline"
                      className="ml-2 h-5 rounded-md px-1.5 text-[10px] border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300"
                    >
                      ativo
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-2 h-5 rounded-md px-1.5 text-[10px]">
                      usando padrão privado
                    </Badge>
                  )}
                </Label>
                <div className="flex items-center gap-1.5">
                  {editing ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => {
                          setDraftPrompt(currentPrompt);
                          setEditing(false);
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" /> Cancelar
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 text-xs"
                        disabled={!isDirty || saveMutation.isPending}
                        onClick={() => saveMutation.mutate()}
                      >
                        {saveMutation.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        Salvar
                      </Button>
                    </>
                  ) : (
                    <>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1.5 text-xs"
                            disabled={!isCustomized || resetMutation.isPending}
                            title={
                              isCustomized ? "Remover prompt customizado" : "Sem prompt customizado"
                            }
                          >
                            {resetMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            Remover customização
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remover prompt customizado?</AlertDialogTitle>
                            <AlertDialogDescription>
                              O prompt customizado desta marca para o agente{" "}
                              <strong>{toTitleCase(agent.agent_name)}</strong> será apagado. O
                              agente voltará a usar o prompt padrão privado da Unitos.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => resetMutation.mutate()}>
                              Remover
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 text-xs"
                        onClick={() => setEditing(true)}
                      >
                        <Pencil className="h-3.5 w-3.5" />{" "}
                        {isCustomized ? "Editar" : "Criar prompt"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {editing ? (
                <Textarea
                  value={draftPrompt}
                  onChange={(e) => setDraftPrompt(e.target.value)}
                  placeholder="Escreva o system prompt desta marca usando variáveis como {{BRAND_NAME}}, {{BRAND_TONE}}, {{PERSONA}}…"
                  className="flex-1 resize-none rounded-md border bg-muted/40 font-mono text-xs leading-relaxed"
                />
              ) : (
                <ScrollArea className="flex-1 rounded-md border bg-muted/40">
                  {currentPrompt ? (
                    <pre className="whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed">
                      {highlightVars(currentPrompt)}
                    </pre>
                  ) : (
                    <div className="space-y-2 p-4 text-xs leading-relaxed text-muted-foreground">
                      <p>
                        Este agente está usando o <strong>prompt padrão privado da Unitos</strong>,
                        que não é exibido por questões de propriedade intelectual.
                      </p>
                      <p>
                        Você pode criar um prompt totalmente customizado para esta marca — ele terá
                        prioridade sobre o padrão em toda execução do agente (playground,
                        planejamento e pipelines).
                      </p>
                    </div>
                  )}
                </ScrollArea>
              )}
            </div>
          </TabsContent>

          <TabsContent value="variables" className="flex-1 overflow-auto p-5 pt-3">
            <VariablesPanel
              vars={vars}
              resolved={resolved}
              overrides={overrides}
              setOverrides={setOverrides}
              loading={resolvedQuery.isFetching}
              hasContext={!!brandId && !!clientId}
            />
          </TabsContent>

          <TabsContent
            value="playground"
            className="flex flex-1 flex-col gap-3 overflow-hidden p-5 pt-3"
          >
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Instrução do usuário (opcional) — o prompt do agente é usado como system.
              </Label>
              <Textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Ex.: gere 3 ideias focadas em conversão para a próxima semana…"
                className="min-h-24"
              />
            </div>
            <Button
              onClick={() => runMutation.mutate()}
              disabled={testing || (!brandId && vars.length > 0)}
              className="w-full gap-2"
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Executar no {model}
            </Button>
            <div className="flex-1 overflow-hidden rounded-md border bg-zinc-950">
              <ScrollArea className="h-full">
                {testing ? (
                  <div className="space-y-2 p-4">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
                    <div className="h-3 w-5/6 animate-pulse rounded bg-zinc-800" />
                  </div>
                ) : testOutput ? (
                  <pre className="whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-emerald-400">
                    {testOutput}
                  </pre>
                ) : (
                  <p className="p-4 font-mono text-xs text-zinc-500">// aguardando execução…</p>
                )}
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function highlightVars(text: string) {
  const parts = text.split(/(\{\{\s*[A-Z0-9_]+\s*\}\})/g);
  return parts.map((p, i) =>
    /^\{\{\s*[A-Z0-9_]+\s*\}\}$/.test(p) ? (
      <span
        key={i}
        className="rounded bg-violet-500/15 px-1 py-0.5 text-violet-600 dark:text-violet-300"
      >
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function VariablesPanel({
  vars,
  resolved,
  overrides,
  setOverrides,
  loading,
  hasContext,
}: {
  vars: string[];
  resolved: ResolvedVariableMap;
  overrides: Record<string, string>;
  setOverrides: (fn: (s: Record<string, string>) => Record<string, string>) => void;
  loading: boolean;
  hasContext: boolean;
}) {
  if (vars.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Este prompt não declara variáveis dinâmicas.</p>
    );
  }
  return (
    <div className="space-y-4">
      {!hasContext && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          Selecione um cliente na barra lateral para hidratar as variáveis com dados reais.
        </div>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Resolvendo variáveis…
        </div>
      )}
      {vars.map((v) => {
        const spec = AGENT_VARIABLE_CATALOG[v];
        const r = resolved[v];
        const isRuntime = spec?.runtimeProvided;
        const isResolved = spec ? (isRuntime ? true : !!r?.resolved) : false;
        const StatusIcon = !spec
          ? HelpCircle
          : isRuntime
            ? Circle
            : isResolved
              ? CheckCircle2
              : AlertTriangle;
        const statusClass = !spec
          ? "text-muted-foreground"
          : isRuntime
            ? "text-sky-500"
            : isResolved
              ? "text-emerald-500"
              : "text-amber-500";
        return (
          <div key={v} className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <StatusIcon className={`h-3.5 w-3.5 ${statusClass}`} />
                  <code className="font-mono text-xs">{`{{${v}}}`}</code>
                  {spec && (
                    <Badge
                      variant="outline"
                      className="h-4 rounded-sm px-1 text-[10px] font-normal"
                    >
                      {CATEGORY_LABEL[spec.category]}
                    </Badge>
                  )}
                  {!spec && (
                    <Badge
                      variant="destructive"
                      className="h-4 rounded-sm px-1 text-[10px] font-normal"
                    >
                      desconhecida
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">
                  {spec?.description ??
                    "Não catalogada. Cadastre em src/lib/agent-variables.ts para que a execução real a hidrate."}
                </p>
                {spec && (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    Fonte: {spec.source}
                  </p>
                )}
              </div>
            </div>
            {spec && !isRuntime && (
              <div className="mt-2">
                <Label className="text-[10px] uppercase text-muted-foreground">Valor atual</Label>
                <div className="mt-1 max-h-24 overflow-auto rounded border bg-background p-2 font-mono text-[11px] leading-relaxed">
                  {r?.value ? (
                    <span>
                      {r.value.slice(0, 600)}
                      {r.value.length > 600 ? "…" : ""}
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      (vazio — preencha no briefing/brand hub)
                    </span>
                  )}
                </div>
              </div>
            )}
            <div className="mt-2">
              <Label className="text-[10px] uppercase text-muted-foreground">
                Override para o playground
              </Label>
              <Input
                className="mt-1 h-8 text-xs"
                value={overrides[v] ?? ""}
                onChange={(e) => setOverrides((s) => ({ ...s, [v]: e.target.value }))}
                placeholder={
                  isRuntime ? "Informe um valor para testar" : "Sobrescrever valor resolvido"
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
