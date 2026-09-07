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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { listClients } from "@/lib/workspace.functions";
import { createMediaPlan, upsertMediaPlanItem } from "@/lib/media-plans.functions";
import { generateMediaPlanWithAi } from "@/lib/media-plans-ai.functions";

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
  const upsertItemFn = useServerFn(upsertMediaPlanItem);
  const aiFn = useServerFn(generateMediaPlanWithAi);

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
  const [objective, setObjective] = useState("");
  const [topo, setTopo] = useState(30);
  const [meio, setMeio] = useState(40);
  const [fundo, setFundo] = useState(30);

  useEffect(() => {
    if (!open) return;
    setClientId(defaultClientId ?? "");
    setTitle(mode === "ai" ? "Plano de mídia (IA)" : "Plano de mídia");
    setMonthlyBudget("");
    setPeriodStart("");
    setPeriodEnd("");
    setObjective("");
    setTopo(30);
    setMeio(40);
    setFundo(30);
  }, [open, mode, defaultClientId]);

  const funnelSum = topo + meio + fundo;
  const budgetNum = Number(monthlyBudget.replace(/[^\d.,-]/g, "").replace(",", "."));
  const canSubmit =
    !!clientId &&
    !!title.trim() &&
    Number.isFinite(budgetNum) &&
    budgetNum >= 0 &&
    (mode === "manual" || (budgetNum > 0 && funnelSum === 100));

  const mutation = useMutation({
    mutationFn: async () => {
      // 1. If AI, generate items first (so we don't create an empty plan when AI fails)
      let items: Awaited<ReturnType<typeof aiFn>>["items"] = [];
      if (mode === "ai") {
        const res = await aiFn({
          data: {
            brandId,
            clientId,
            monthlyBudget: budgetNum,
            objective: objective.trim() || null,
            funnelSplit: { topo, meio, fundo },
          },
        });
        items = res.items;
        if (!items || items.length === 0) throw new Error("A IA não retornou iniciativas.");
      }

      // 2. Create plan
      const { plan } = await createFn({
        data: {
          brandId,
          clientId,
          title: title.trim() || "Plano de mídia",
          monthly_budget: budgetNum || 0,
          period_start: periodStart || null,
          period_end: periodEnd || null,
        },
      });

      // 3. Insert items sequentially (small N)
      if (mode === "ai") {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          await upsertItemFn({
            data: {
              planId: plan.id,
              item: {
                position: i,
                product_service: it.product_service,
                campaign_type: it.campaign_type,
                funnel_stage: it.funnel_stage,
                channel: it.channel,
                main_kpi: it.main_kpi,
                audience: it.audience,
                budget_pct: it.budget_pct,
                keywords: it.keywords,
              },
            },
          });
        }
      }

      return plan;
    },
    onSuccess: async (plan) => {
      await qc.invalidateQueries({ queryKey: ["brand-media-plans", brandId] });
      toast.success(mode === "ai" ? "Plano gerado por IA com sucesso" : "Plano criado com sucesso");
      onOpenChange(false);
      navigate({
        to: "/customers/$customerId/media-plan",
        params: { customerId: plan.client_id },
        search: { planId: plan.id },
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar o plano");
    },
  });

  const clients = useMemo(
    () => (clientsQ.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    [clientsQ.data],
  );

  const isAi = mode === "ai";
  const busy = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => (!busy ? onOpenChange(o) : null)}>
      <DialogContent className="sm:max-w-[560px]">
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
                  ? "A IA monta 6 a 10 iniciativas balanceando canais e etapas do funil."
                  : "Defina cliente, período e orçamento. Você adiciona as iniciativas depois."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <Field label="Cliente" required>
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

          <Field label={isAi ? "Orçamento mensal (R$)" : "Orçamento mensal (R$)"} required={isAi}>
            <Input
              inputMode="decimal"
              value={monthlyBudget}
              onChange={(e) => setMonthlyBudget(e.target.value)}
              placeholder="Ex.: 25000"
              disabled={busy}
              className="h-9"
            />
          </Field>

          {isAi && (
            <>
              <Field
                label="Contexto / objetivo"
                hint="Opcional — enriquece o prompt (ex.: lançar linha premium, gerar leads B2B)."
              >
                <Textarea
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="Descreva o objetivo do mês, ofertas, promoções ou restrições…"
                  disabled={busy}
                  className="min-h-[80px] resize-none"
                />
              </Field>

              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium">Distribuição por funil</span>
                  <span
                    className={cn(
                      "tabular-nums",
                      funnelSum === 100
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    Total {funnelSum}%
                  </span>
                </div>
                <FunnelSlider label="Topo" value={topo} onChange={setTopo} disabled={busy} />
                <FunnelSlider label="Meio" value={meio} onChange={setMeio} disabled={busy} />
                <FunnelSlider label="Fundo" value={fundo} onChange={setFundo} disabled={busy} />
                {funnelSum !== 100 && (
                  <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                    A soma precisa ser 100% para gerar.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || busy}
            className={cn(isAi && "bg-indigo-600 text-white hover:bg-indigo-500")}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isAi ? "IA montando alocação por canal…" : "Criando plano…"}
              </>
            ) : isAi ? (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Gerar plano
              </>
            ) : (
              "Criar plano"
            )}
          </Button>
        </DialogFooter>
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

function FunnelSlider({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-12 text-[11px] font-medium text-muted-foreground">{label}</div>
      <Slider
        value={[value]}
        min={0}
        max={100}
        step={5}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0] ?? 0)}
        className="flex-1"
      />
      <div className="w-10 text-right text-xs tabular-nums">{value}%</div>
    </div>
  );
}
