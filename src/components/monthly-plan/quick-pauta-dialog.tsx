/**
 * Mini-pauta expressa: uma tela só (projeto, canal, quantidade, tema opcional)
 * e a IA já entrega os temas aprovados internamente. A partir daí, a regra do
 * cliente decide: ou as peças nascem em Produção com a legenda escrita, ou a
 * pauta vai para o cliente aprovar. Nada disso é decidido aqui — o servidor
 * aplica a mesma política e o mesmo limite de produção do fluxo completo.
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Rocket, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/errors";
import {
  PautaOrganizationField,
  requiredOrganization,
  toOrganizationInput,
  type OrganizationDraft,
} from "@/components/monthly-plan/pauta-organization-field";
import { PLAN_CHANNELS, PLAN_CHANNEL_LABEL } from "@/lib/monthly-plan-fields";
import type { PlanChannel } from "@/lib/monthly-plan-fields";
import { quickPlanFn, type QuickPlanResult } from "@/lib/monthly-plans.functions";

const STEPS = [
  "Lendo o briefing do cliente…",
  "Escolhendo os melhores ganchos…",
  "Escrevendo os títulos…",
  "Aprovando e organizando…",
  "Escrevendo as legendas…",
];

export function QuickPautaDialog({
  open,
  onOpenChange,
  brandId,
  clientId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  clientId: string;
  /** Abre a pauta criada. */
  onDone: (planId: string) => void;
}) {
  const qc = useQueryClient();
  const quickPlan = useServerFn(quickPlanFn);

  const [organization, setOrganization] = React.useState<OrganizationDraft>(requiredOrganization);
  const [channel, setChannel] = React.useState<PlanChannel>(PLAN_CHANNELS[0]!);
  const [quantity, setQuantity] = React.useState(4);
  const [theme, setTheme] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [step, setStep] = React.useState(0);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => {
    if (!open) {
      setError(null);
      setStep(0);
    }
  }, [open]);
  React.useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const orgInput = toOrganizationInput(organization, false);

  const run = useMutation({
    mutationFn: () => {
      if (!orgInput) throw new Error("Escolha um projeto existente ou informe o nome do novo.");
      return quickPlan({
        data: {
          brandId,
          clientId,
          channel,
          quantity,
          theme: theme.trim(),
          organization: orgInput,
        },
      });
    },
    onMutate: () => {
      setError(null);
      setStep(0);
      timer.current = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2200);
    },
    onSettled: () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    },
    onSuccess: (result: QuickPlanResult) => {
      if (!result.ok) {
        const msg = describeError(result.code);
        setError(msg);
        toast.error(`Não foi possível criar a pauta: ${msg}`);
        return;
      }
      qc.invalidateQueries({ queryKey: ["monthly-plans", "list", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["monthly-plan", "volumetry", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["content-board"] });
      toast.success(
        result.inProduction
          ? `Pauta criada com ${result.topics} itens — ${result.cardsCreated} peça(s) já em Produção, com a legenda sendo escrita.`
          : `Pauta criada com ${result.topics} itens e enviada ao cliente para aprovação.`,
      );
      onOpenChange(false);
      onDone(result.planId);
    },
    onError: (err) => {
      const msg = describeError(err);
      setError(msg);
      toast.error(msg);
    },
  });

  const busy = run.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Durante a geração o fechamento é bloqueado: fechar perderia o progresso.
        if (busy) return;
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg" onInteractOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-4 w-4 text-primary" />
            Pauta expressa
          </DialogTitle>
          <DialogDescription>
            Caminho curto: a IA cria os temas, aprova internamente e já segue para a próxima etapa
            conforme a regra deste cliente. O limite mensal contratado continua valendo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <PautaOrganizationField
            brandId={brandId}
            clientId={clientId}
            value={organization}
            onChange={setOrganization}
            allowNone={false}
          />

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Onde vai publicar <span className="text-primary">*</span>
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {PLAN_CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={busy}
                  onClick={() => setChannel(c)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    channel === c
                      ? "border-primary/60 bg-primary/[0.08] text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {PLAN_CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label htmlFor="quick-qty" className="text-xs">
                Quantas peças
              </Label>
              <Input
                id="quick-qty"
                type="number"
                min={1}
                max={30}
                disabled={busy}
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.min(30, Math.max(1, Number(e.target.value) || 1)))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-theme" className="text-xs">
                Tema <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Textarea
                id="quick-theme"
                rows={2}
                disabled={busy}
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="Sem tema, a IA usa o briefing do cliente"
              />
            </div>
          </div>

          {busy && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.05] px-3 py-2.5 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>{STEPS[step]}</span>
            </div>
          )}
          {error && !busy && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="ai" className="gap-2" disabled={busy || !orgInput} onClick={() => run.mutate()}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : error ? (
              <RefreshCw className="h-4 w-4" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {busy ? "Criando…" : error ? "Tentar de novo" : "Criar pauta agora"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
