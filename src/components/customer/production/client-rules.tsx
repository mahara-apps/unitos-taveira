// Regras do cliente: quais etapas o cliente aprova e o que o limite de
// produção faz quando é estourado. Somente Owner/Admin alteram.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Info, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
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
import { useAccessRole } from "@/hooks/use-access-role";
import { describeError } from "@/lib/errors";
import {
  APPROVAL_STAGES,
  APPROVAL_STAGE_LABEL,
  SCOPE_FRONTS,
  SCOPE_FRONT_LABEL,
  defaultApprovalPolicy,
  defaultScopePolicy,
  type ApprovalPolicy,
  type ApprovalStage,
  type ScopeFront,
  type ScopePolicy,
} from "@/lib/client-policy";
import { getClientPoliciesFn, setClientPoliciesFn } from "@/lib/client-policy.functions";

const STAGE_HINT: Record<ApprovalStage, string> = {
  plan: "Pauta do mês enviada para o cliente aprovar antes de produzir.",
  content: "Peça pronta enviada para o cliente aprovar antes de publicar.",
  schedule: "Datas sugeridas confirmadas pelo cliente antes de reservar.",
};

export function ClientRules({ brandId, clientId }: { brandId: string; clientId: string }) {
  const qc = useQueryClient();
  const { role } = useAccessRole();
  const canEdit = role === "admin";

  const get = useServerFn(getClientPoliciesFn);
  const q = useQuery({
    queryKey: ["client-policies", brandId, clientId],
    queryFn: () => get({ data: { brandId, clientId } }),
    staleTime: 20_000,
  });

  const [approval, setApproval] = useState<ApprovalPolicy>(defaultApprovalPolicy());
  const [scope, setScope] = useState<ScopePolicy>(defaultScopePolicy());
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setApproval(q.data.approval);
    setScope(q.data.scope);
  }, [q.data]);

  const save = useServerFn(setClientPoliciesFn);
  const saveM = useMutation({
    mutationFn: (pendingAction: "keep" | "release") =>
      save({ data: { brandId, clientId, approval, scope, pendingAction } }),
    onSuccess: (res) => {
      const total = res.released.plan + res.released.content + res.released.schedule;
      toast.success("Regras do cliente salvas.", {
        description: total > 0 ? `${total} item(ns) liberado(s) para o time seguir.` : undefined,
      });
      void qc.invalidateQueries({ queryKey: ["client-policies", brandId, clientId] });
      void qc.invalidateQueries({ queryKey: ["plan-overages", brandId, clientId] });
    },
    onError: (e) => toast.error(`Não foi possível salvar: ${describeError(e)}`),
  });

  const pending = q.data?.pending ?? { plan: 0, content: 0, schedule: 0 };
  const waivedWithPending = APPROVAL_STAGES.filter(
    (s) => approval[s] === "internal" && (pending[s] ?? 0) > 0,
  );

  const onSave = () => {
    if (waivedWithPending.length > 0) setConfirmOpen(true);
    else saveM.mutate("keep");
  };

  if (q.isLoading) {
    return (
      <DashboardPanelSurface className="space-y-3 p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full" />
      </DashboardPanelSurface>
    );
  }

  return (
    <DashboardPanelSurface className="space-y-6 p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Regras do cliente</h3>
        <p className="text-xs text-muted-foreground">
          Definem se este cliente aprova cada etapa e como o limite de produção se comporta. O
          escopo do contrato continua vindo do briefing.
        </p>
      </div>

      <div className="space-y-3">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Aprovação do cliente
        </Label>
        {APPROVAL_STAGES.map((stage) => (
          <div
            key={stage}
            className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{APPROVAL_STAGE_LABEL[stage]}</span>
                {approval[stage] === "internal" ? (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                    Time avança direto
                  </Badge>
                ) : (
                  <Badge variant="outline">Cliente aprova</Badge>
                )}
                {(pending[stage] ?? 0) > 0 && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-500">
                    {pending[stage]} aguardando
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{STAGE_HINT[stage]}</p>
            </div>
            <Switch
              aria-label={`Exigir aprovação do cliente em ${APPROVAL_STAGE_LABEL[stage]}`}
              checked={approval[stage] === "client"}
              disabled={!canEdit || saveM.isPending}
              onCheckedChange={(v) =>
                setApproval((prev) => ({ ...prev, [stage]: v ? "client" : "internal" }))
              }
            />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Limite de produção
        </Label>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
          <div className="space-y-1">
            <span className="text-sm font-medium">Bloquear ao passar do contrato</span>
            <p className="text-xs text-muted-foreground">
              Desligado, o excedente só gera aviso e fica registrado no histórico.
            </p>
          </div>
          <Switch
            aria-label="Bloquear ao passar do contrato"
            checked={scope.mode === "block"}
            disabled={!canEdit || saveM.isPending}
            onCheckedChange={(v) => setScope((prev) => ({ ...prev, mode: v ? "block" : "warn" }))}
          />
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <p className="mb-2 text-xs text-muted-foreground">Onde o bloqueio vale:</p>
          <div className="space-y-2">
            {SCOPE_FRONTS.map((front: ScopeFront) => (
              <label key={front} className="flex items-center justify-between gap-4 text-sm">
                <span>{SCOPE_FRONT_LABEL[front]}</span>
                <Switch
                  aria-label={SCOPE_FRONT_LABEL[front]}
                  checked={scope.applies.includes(front)}
                  disabled={!canEdit || scope.mode !== "block" || saveM.isPending}
                  onCheckedChange={(v) =>
                    setScope((prev) => ({
                      ...prev,
                      applies: v
                        ? Array.from(new Set([...prev.applies, front]))
                        : prev.applies.filter((f) => f !== front),
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      {!canEdit ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> Apenas Owner e Admin podem alterar estas regras.
        </p>
      ) : (
        <div className="flex justify-end">
          <Button size="sm" onClick={onSave} disabled={saveM.isPending}>
            {saveM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar regras
          </Button>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Existem itens aguardando o cliente</AlertDialogTitle>
            <AlertDialogDescription>
              {waivedWithPending
                .map((s) => `${pending[s]} em ${APPROVAL_STAGE_LABEL[s].toLowerCase()}`)
                .join(", ")}
              . Você quer liberar agora para o time seguir, ou manter aguardando a resposta do
              cliente?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                saveM.mutate("keep");
              }}
            >
              Manter aguardando
            </Button>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                saveM.mutate("release");
              }}
            >
              Liberar agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardPanelSurface>
  );
}
