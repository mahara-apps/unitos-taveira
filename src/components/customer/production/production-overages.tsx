// Solicitações extras / excedentes do cliente — extraído da antiga tela
// Configurações → Excedentes, agora escopado a um único cliente.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { useAccessRole } from "@/hooks/use-access-role";
import { describeError } from "@/lib/errors";
import { PLAN_CHANNEL_LABEL, type PlanChannel } from "@/lib/monthly-plan-fields";
import { Switch } from "@/components/ui/switch";
import {
  decidePlanOverageFn,
  getOveragePolicyFn,
  listPlanOverageRequestsFn,
  setClientOveragePolicyFn,
  type OverageRequestRow,
} from "@/lib/plan-overage.functions";

const STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando liberação",
  approved: "Autorizado",
  rejected: "Recusado",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  rejected: "border-destructive/40 bg-destructive/10 text-destructive",
};

function formatDate(v: string) {
  return new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function ProductionOverages({ brandId, clientId }: { brandId: string; clientId: string }) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const qc = useQueryClient();
  const { role } = useAccessRole();
  const canDecide = role === "admin";

  const list = useServerFn(listPlanOverageRequestsFn);
  const listQ = useQuery({
    queryKey: ["plan-overages", brandId, clientId, status],
    queryFn: () => list({ data: { brandId, clientId, status } }),
    staleTime: 20_000,
  });

  const decide = useServerFn(decidePlanOverageFn);
  const decideM = useMutation({
    mutationFn: (input: { id: string; decision: "approved" | "rejected" }) =>
      decide({ data: input }),
    onSuccess: (_r, vars) => {
      toast.success(vars.decision === "approved" ? "Excedente autorizado." : "Excedente recusado.");
      qc.invalidateQueries({ queryKey: ["plan-overages"] });
      qc.invalidateQueries({ queryKey: ["monthly-plan", "volumetry"] });
    },
    onError: (err) => toast.error(describeError(err)),
  });

  const rows = (listQ.data ?? []) as OverageRequestRow[];
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  const getPolicy = useServerFn(getOveragePolicyFn);
  const policyQ = useQuery({
    queryKey: ["plan-overage-policy", brandId, clientId],
    queryFn: () => getPolicy({ data: { brandId, clientId } }),
    staleTime: 60_000,
  });
  const setPolicy = useServerFn(setClientOveragePolicyFn);
  const policyM = useMutation({
    mutationFn: (policy: "block" | "warn") =>
      setPolicy({ data: { brandId, clientId, policy } }),
    onSuccess: (_r, policy) => {
      toast.success(
        policy === "warn"
          ? "Volumetria livre ativada para este cliente."
          : "Excedente volta a exigir liberação.",
      );
      qc.invalidateQueries({ queryKey: ["plan-overage-policy"] });
      qc.invalidateQueries({ queryKey: ["monthly-plan", "volumetry"] });
    },
    onError: (err) => toast.error(describeError(err)),
  });
  const freeVolume = policyQ.data?.effective === "warn";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Solicitações extras e excedentes</h2>
          <p className="text-xs text-muted-foreground">
            Peças pedidas acima da volumetria contratada, com data e autorização.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canDecide ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={freeVolume}
                disabled={policyQ.isLoading || policyM.isPending}
                onCheckedChange={(v) => policyM.mutate(v ? "warn" : "block")}
              />
              Volumetria livre
            </label>
          ) : null}
          <Tabs value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <TabsList>
              <TabsTrigger value="pending">
                Pendentes{pendingCount ? ` (${pendingCount})` : ""}
              </TabsTrigger>
              <TabsTrigger value="approved">Autorizados</TabsTrigger>
              <TabsTrigger value="rejected">Recusados</TabsTrigger>
              <TabsTrigger value="all">Todos</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {freeVolume ? (
        <p className="text-[11px] text-muted-foreground">
          Volumetria livre ativa: a equipe pode gerar acima da cota e o excedente fica registrado
          aqui automaticamente.
        </p>
      ) : null}

      {listQ.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <DashboardPanelSurface className="p-6 text-sm text-muted-foreground">
          Nenhuma solicitação de excedente nesta visão.
        </DashboardPanelSurface>
      ) : (
        <DashboardPanelSurface className="divide-y divide-border/60">
          {rows.map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-4 sm:flex sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {PLAN_CHANNEL_LABEL[r.channel as PlanChannel] ?? r.channel}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${STATUS_CLASS[r.status] ?? ""}`}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                  {r.requested} pedidas · {r.quota} disponíveis ·{" "}
                  <span className="font-medium text-amber-500">+{r.overage} excedente</span> ·{" "}
                  {formatDate(r.created_at)}
                  {r.requester_name ? ` · por ${r.requester_name}` : ""}
                </p>
                {r.justification ? (
                  <p className="mt-1 text-xs text-muted-foreground">“{r.justification}”</p>
                ) : null}
              </div>
              {r.status === "pending" && canDecide ? (
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decideM.isPending}
                    onClick={() => decideM.mutate({ id: r.id, decision: "rejected" })}
                    className="gap-1.5"
                  >
                    <X className="h-3.5 w-3.5" /> Recusar
                  </Button>
                  <Button
                    size="sm"
                    disabled={decideM.isPending}
                    onClick={() => decideM.mutate({ id: r.id, decision: "approved" })}
                    className="gap-1.5 border-0 bg-emerald-600 text-white hover:bg-emerald-600/90"
                  >
                    {decideM.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Autorizar
                  </Button>
                </div>
              ) : (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {r.status === "pending"
                    ? "Aguardando o gestor da conta"
                    : r.decided_at
                      ? formatDate(r.decided_at)
                      : ""}
                </span>
              )}
            </div>
          ))}
        </DashboardPanelSurface>
      )}
    </section>
  );
}
