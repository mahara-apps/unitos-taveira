import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listClients } from "@/lib/workspace.functions";
import { createMediaPlan } from "@/lib/media-plans.functions";
import { createMediaPlanFromInterview } from "@/lib/media-plan-interview.functions";
import { aiErrorMessage } from "@/lib/ai-error-display";
import {
  MediaPlanInterview,
  type InterviewResult,
} from "@/components/media-plans/media-plan-interview";

type Mode = "manual" | "ai";

type Props = {
  open: boolean;
  mode: Mode;
  brandId: string;
  onOpenChange: (open: boolean) => void;
  defaultClientId?: string;
};

export function CreateMediaPlanDialog({
  open,
  mode,
  brandId,
  onOpenChange,
  defaultClientId,
}: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const listClientsFn = useServerFn(listClients);
  const createFn = useServerFn(createMediaPlan);
  const interviewFn = useServerFn(createMediaPlanFromInterview);

  const clientsQ = useQuery({
    queryKey: ["workspace-clients", brandId],
    queryFn: () => listClientsFn({ data: { brandId } }),
    enabled: !!brandId && open,
  });

  const [clientId, setClientId] = useState<string>(defaultClientId ?? "");
  const [title, setTitle] = useState("Plano de mídia");
  const [monthlyBudget, setMonthlyBudget] = useState<string>("");
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  /** Modo IA: passo 1 = dados básicos, passo 2 = entrevista guiada. */
  const [stage, setStage] = useState<"basics" | "interview">("basics");

  useEffect(() => {
    if (!open) return;
    setClientId(defaultClientId ?? "");
    setTitle(mode === "ai" ? "Plano de mídia (IA)" : "Plano de mídia");
    setMonthlyBudget("");
    setPeriodStart("");
    setPeriodEnd("");
    setStage("basics");
  }, [open, mode, defaultClientId]);

  const budgetNum = Number(monthlyBudget.replace(/[^\d.,-]/g, "").replace(",", "."));
  const basicsReady = !!clientId && !!title.trim();
  const canSubmit = basicsReady && Number.isFinite(budgetNum) && budgetNum >= 0;

  const goToPlan = async (plan: { id: string; client_id: string }, message: string) => {
    await qc.invalidateQueries({ queryKey: ["brand-media-plans", brandId] });
    toast.success(message);
    onOpenChange(false);
    navigate({
      to: "/customers/$customerId/media-plan",
      params: { customerId: plan.client_id },
      search: { planId: plan.id },
    });
  };

  const manualMutation = useMutation({
    mutationFn: async () => {
      const res = await createFn({
        data: {
          brandId,
          clientId,
          title: title.trim() || "Plano de mídia",
          monthly_budget: budgetNum || 0,
          period_start: periodStart || null,
          period_end: periodEnd || null,
        },
      });
      return (res as { plan: { id: string; client_id: string } }).plan;
    },
    onSuccess: (plan) => void goToPlan(plan, "Plano criado com sucesso"),
    onError: (err) => {
      toast.error(aiErrorMessage(err, "Não foi possível criar o plano"));
    },
  });

  const interviewMutation = useMutation({
    mutationFn: async (result: InterviewResult) => {
      const res = await interviewFn({
        data: {
          brandId,
          clientId,
          title: title.trim() || "Plano de mídia",
          period_start: periodStart || null,
          period_end: periodEnd || null,
          monthlyBudget: result.monthlyBudget,
          interview: result.answers,
          funnelSplit: result.funnelSplit,
        },
      });
      return (res as { plan: { id: string; client_id: string } }).plan;
    },
    onSuccess: (plan) => void goToPlan(plan, "Plano de mídia gerado com sucesso"),
    onError: (err) => {
      toast.error(aiErrorMessage(err, "Não foi possível gerar o plano"));
    },
  });

  const clients = useMemo(
    () => (clientsQ.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    [clientsQ.data],
  );

  /** Cliente vindo do contexto de operação: fixo, sem seletor. */
  const lockedClient = !!defaultClientId;
  const lockedClientName =
    clients.find((c) => c.id === defaultClientId)?.name ?? "Cliente da operação";

  const isAi = mode === "ai";
  const busy = manualMutation.isPending || interviewMutation.isPending;
  const inInterview = isAi && stage === "interview";


  return (
    <Dialog open={open} onOpenChange={(o) => (!busy ? onOpenChange(o) : null)}>
      <DialogContent
        className={cn(inInterview ? "sm:max-w-[720px]" : "sm:max-w-[560px]")}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md text-white shadow-sm",
                isAi ? "bg-indigo-600" : "bg-foreground",
              )}
            >
              {isAi ? <Sparkles className="h-4 w-4" /> : <Target className="h-4 w-4" />}
            </span>
            <div>
              <DialogTitle>{isAi ? "Gerar plano com IA" : "Novo plano de mídia"}</DialogTitle>
              <DialogDescription>
                {isAi
                  ? "Responda algumas perguntas simples e o especialista monta as campanhas de Meta e Google."
                  : "Defina cliente, período e orçamento. Você adiciona as iniciativas depois."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {inInterview ? (
          <div className="max-h-[70vh] min-h-[420px]">
            <MediaPlanInterview
              submitting={busy}
              onCancel={() => setStage("basics")}
              onSubmit={(result) => interviewMutation.mutate(result)}
            />
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-1">
              <Field
                label="Cliente"
                required
                hint={
                  lockedClient
                    ? "Este plano será criado na operação do cliente selecionado."
                    : undefined
                }
              >
                {lockedClient ? (
                  <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/40 px-3 text-sm font-medium">
                    {lockedClientName}
                  </div>
                ) : (
                  <Select value={clientId} onValueChange={setClientId} disabled={busy}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Selecionar cliente…" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Nenhum cliente ativo neste workspace.
                        </div>
                      ) : (
                        clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                )}
              </Field>


              <Field label="Título">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Plano de mídia"
                  disabled={busy}
                  className="h-9"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Início">
                  <Input
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    disabled={busy}
                    className="h-9"
                  />
                </Field>
                <Field label="Fim">
                  <Input
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    disabled={busy}
                    className="h-9"
                  />
                </Field>
              </div>

              {!isAi && (
                <Field label="Orçamento mensal (R$)">
                  <Input
                    inputMode="decimal"
                    value={monthlyBudget}
                    onChange={(e) => setMonthlyBudget(e.target.value)}
                    placeholder="Ex.: 25000"
                    disabled={busy}
                    className="h-9"
                  />
                </Field>
              )}

              {isAi && (
                <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  No próximo passo você responde a entrevista guiada — inclusive quanto o cliente
                  pode investir por mês. Nada de termos técnicos.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancelar
              </Button>
              <Button
                onClick={() => (isAi ? setStage("interview") : manualMutation.mutate())}
                disabled={(isAi ? !basicsReady : !canSubmit) || busy}
                className={cn(isAi && "bg-indigo-600 text-white hover:bg-indigo-500")}
              >
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando plano…
                  </>
                ) : isAi ? (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Começar entrevista
                  </>
                ) : (
                  "Criar plano"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
