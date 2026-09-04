import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Trash2,
  User as UserIcon,
  Users as UsersIcon,
} from "lucide-react";

import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  deleteAiUsageLimitFn,
  listAiUsageOverviewFn,
  upsertAiUsageLimitFn,
  type UsageOverview,
} from "@/lib/ai-limits.functions";

/**
 * AiUsagePanel — Limites e consumo de IA (agência → cliente → usuário).
 * Mesmas server functions e regras de hierarquia/RLS; apenas mudou de lugar
 * (Settings → Centro de IA).
 */
type LimitDialogState = {
  open: boolean;
  scope: "brand" | "client" | "user";
  clientId?: string | null;
  userId?: string | null;
  targetLabel: string;
  limitUsd: number;
  hardStop: boolean;
  notifyAtPct: number;
  limitId?: string | null;
};

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "USD" });

const pct = (spent: number, limit: number | null | undefined) => {
  if (!limit || limit <= 0) return null;
  return Math.min(999, Math.round((spent / limit) * 100));
};

function StatusBadge({
  spent,
  limit,
  hardStop,
  notifyAtPct,
}: {
  spent: number;
  limit: number | null | undefined;
  hardStop: boolean | null | undefined;
  notifyAtPct: number | null | undefined;
}) {
  const p = pct(spent, limit);
  if (p == null)
    return (
      <Badge variant="outline" className="text-[10px]">
        Sem limite
      </Badge>
    );
  if (p >= 100 && hardStop)
    return (
      <Badge variant="destructive" className="text-[10px]">
        <ShieldAlert className="mr-1 h-3 w-3" />
        Bloqueado
      </Badge>
    );
  if (p >= (notifyAtPct ?? 80))
    return <Badge className="bg-amber-500 text-[10px] hover:bg-amber-500">Atenção</Badge>;
  return (
    <Badge variant="secondary" className="text-[10px]">
      Ok
    </Badge>
  );
}

function ScopeRow({
  indent = 0,
  icon,
  title,
  subtitle,
  spent,
  limit,
  hardStop,
  notifyAtPct,
  onEdit,
  onDelete,
  expandable,
  expanded,
  onToggle,
}: {
  indent?: number;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  spent: number;
  limit: number | null;
  hardStop: boolean | null;
  notifyAtPct: number | null;
  onEdit: () => void;
  onDelete?: () => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const p = pct(spent, limit);
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_140px_140px_120px_160px] items-center gap-4 border-b border-border/60 px-4 py-3 last:border-0"
      style={{ paddingLeft: 16 + indent * 24 }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            className="grid h-5 w-5 place-items-center rounded hover:bg-muted"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        ) : (
          <span className="inline-block w-5" />
        )}
        <span className="text-muted-foreground">{icon}</span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle ? (
            <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
      </div>
      <div className="text-right text-sm tabular-nums">{money(spent)}</div>
      <div className="text-right text-sm tabular-nums text-muted-foreground">{money(limit)}</div>
      <div className="flex items-center justify-end gap-2">
        {p != null ? (
          <>
            <Progress value={Math.min(100, p)} className="h-1.5 w-16" />
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{p}%</span>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <StatusBadge spent={spent} limit={limit} hardStop={hardStop} notifyAtPct={notifyAtPct} />
        <Button variant="ghost" size="sm" onClick={onEdit}>
          {limit != null ? "Editar" : "Definir"}
        </Button>
        {onDelete ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function AiUsagePanel({ brandId }: { brandId: string | null }) {
  const qc = useQueryClient();
  const fetchOverview = useServerFn(listAiUsageOverviewFn);
  const upsertLimit = useServerFn(upsertAiUsageLimitFn);
  const deleteLimit = useServerFn(deleteAiUsageLimitFn);

  const overviewQ = useQuery({
    queryKey: ["ai-usage-overview", brandId],
    queryFn: () => fetchOverview({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<LimitDialogState | null>(null);

  const overview: UsageOverview | undefined = overviewQ.data;

  const usersByClient = useMemo(() => {
    const map = new Map<string, UsageOverview["users"]>();
    (overview?.users ?? []).forEach((u) => {
      const key = u.client_id ?? "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(u);
    });
    return map;
  }, [overview]);

  const upsertMut = useMutation({
    mutationFn: (input: {
      scope: "brand" | "client" | "user";
      clientId?: string | null;
      userId?: string | null;
      limitUsd: number;
      hardStop: boolean;
      notifyAtPct: number;
    }) =>
      upsertLimit({
        data: {
          brandId: brandId!,
          scope: input.scope,
          clientId: input.clientId ?? null,
          userId: input.userId ?? null,
          limitUsd: input.limitUsd,
          hardStop: input.hardStop,
          notifyAtPct: input.notifyAtPct,
        },
      }),
    onSuccess: () => {
      toast.success("Limite atualizado");
      qc.invalidateQueries({ queryKey: ["ai-usage-overview", brandId] });
      setDialog(null);
    },
    onError: (e: Error) => toast.error(e.message ?? "Falha ao salvar limite"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteLimit({ data: { id } }),
    onSuccess: () => {
      toast.success("Limite removido");
      qc.invalidateQueries({ queryKey: ["ai-usage-overview", brandId] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Falha ao remover limite"),
  });

  if (!brandId) {
    return (
      <DashboardPanelSurface className="p-6 text-sm text-muted-foreground">
        Selecione uma agência para configurar limites de IA.
      </DashboardPanelSurface>
    );
  }

  const openBrand = () =>
    setDialog({
      open: true,
      scope: "brand",
      targetLabel: "Agência",
      limitUsd: overview?.brand.limit ?? 0,
      hardStop: overview?.brand.hard_stop ?? true,
      notifyAtPct: overview?.brand.notify_at_pct ?? 80,
      limitId: null,
    });

  return (
    <div className="space-y-4">
      <DashboardPanelSurface className="p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_140px_140px_120px_160px] gap-4 border-b border-border/60 px-4 pb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <div>Escopo</div>
          <div className="text-right">Gasto (mês)</div>
          <div className="text-right">Limite</div>
          <div className="text-right">Consumo</div>
          <div className="text-right">Ação</div>
        </div>

        {overview ? (
          <ScopeRow
            icon={<Building2 className="h-4 w-4" />}
            title="Agência (total)"
            subtitle="Teto global de gasto mensal em IA"
            spent={Number(overview.brand.spent) || 0}
            limit={overview.brand.limit != null ? Number(overview.brand.limit) : null}
            hardStop={overview.brand.hard_stop}
            notifyAtPct={overview.brand.notify_at_pct}
            onEdit={openBrand}
          />
        ) : (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        )}

        {overview?.clients.map((c) => {
          const expanded = !!expandedClients[c.client_id];
          const users = usersByClient.get(c.client_id) ?? [];
          return (
            <div key={c.client_id}>
              <ScopeRow
                indent={1}
                icon={<UsersIcon className="h-4 w-4" />}
                title={c.client_name}
                spent={Number(c.spent) || 0}
                limit={c.limit != null ? Number(c.limit) : null}
                hardStop={c.hard_stop}
                notifyAtPct={c.notify_at_pct}
                expandable={users.length > 0}
                expanded={expanded}
                onToggle={() =>
                  setExpandedClients((s) => ({ ...s, [c.client_id]: !s[c.client_id] }))
                }
                onEdit={() =>
                  setDialog({
                    open: true,
                    scope: "client",
                    clientId: c.client_id,
                    targetLabel: c.client_name,
                    limitUsd:
                      c.limit != null
                        ? Number(c.limit)
                        : overview.brand.limit != null
                          ? Number(overview.brand.limit)
                          : 0,
                    hardStop: c.hard_stop ?? true,
                    notifyAtPct: c.notify_at_pct ?? 80,
                    limitId: c.limit_id,
                  })
                }
                onDelete={c.limit_id ? () => deleteMut.mutate(c.limit_id!) : undefined}
              />
              {expanded &&
                users.map((u) => (
                  <ScopeRow
                    key={`${u.user_id}-${u.client_id ?? "none"}`}
                    indent={2}
                    icon={<UserIcon className="h-4 w-4" />}
                    title={u.display_name || u.email || "Usuário"}
                    subtitle={u.display_name && u.email ? u.email : undefined}
                    spent={Number(u.spent) || 0}
                    limit={u.limit != null ? Number(u.limit) : null}
                    hardStop={u.hard_stop}
                    notifyAtPct={u.notify_at_pct}
                    onEdit={() =>
                      setDialog({
                        open: true,
                        scope: "user",
                        clientId: c.client_id,
                        userId: u.user_id,
                        targetLabel: `${u.display_name || u.email || "Usuário"} · ${c.client_name}`,
                        limitUsd:
                          u.limit != null ? Number(u.limit) : c.limit != null ? Number(c.limit) : 0,
                        hardStop: u.hard_stop ?? true,
                        notifyAtPct: u.notify_at_pct ?? 80,
                        limitId: u.limit_id,
                      })
                    }
                    onDelete={u.limit_id ? () => deleteMut.mutate(u.limit_id!) : undefined}
                  />
                ))}
            </div>
          );
        })}

        {overview ? (
          <>
            <ScopeRow
              indent={1}
              icon={<UsersIcon className="h-4 w-4" />}
              title="Sem cliente vinculado"
              subtitle="Gasto de IA que não foi atribuído a um cliente"
              spent={Number(overview.unassigned_client_spent) || 0}
              limit={null}
              hardStop={null}
              notifyAtPct={null}
              expandable={(usersByClient.get("__none__")?.length ?? 0) > 0}
              expanded={!!expandedClients["__none__"]}
              onToggle={() => setExpandedClients((s) => ({ ...s, __none__: !s["__none__"] }))}
              onEdit={openBrand}
            />
            {expandedClients["__none__"] &&
              (usersByClient.get("__none__") ?? []).map((u) => (
                <ScopeRow
                  key={`${u.user_id}-none`}
                  indent={2}
                  icon={<UserIcon className="h-4 w-4" />}
                  title={u.display_name || u.email || "Usuário"}
                  subtitle={u.display_name && u.email ? u.email : undefined}
                  spent={Number(u.spent) || 0}
                  limit={u.limit != null ? Number(u.limit) : null}
                  hardStop={u.hard_stop}
                  notifyAtPct={u.notify_at_pct}
                  onEdit={() =>
                    setDialog({
                      open: true,
                      scope: "user",
                      clientId: null,
                      userId: u.user_id,
                      targetLabel: u.display_name || u.email || "Usuário",
                      limitUsd: u.limit != null ? Number(u.limit) : 0,
                      hardStop: u.hard_stop ?? true,
                      notifyAtPct: u.notify_at_pct ?? 80,
                      limitId: u.limit_id,
                    })
                  }
                  onDelete={u.limit_id ? () => deleteMut.mutate(u.limit_id!) : undefined}
                />
              ))}
          </>
        ) : null}
      </DashboardPanelSurface>

      <p className="text-xs text-muted-foreground">
        Período: mês atual. Ao atingir 100% de um limite com bloqueio ativado, novas execuções de IA
        no escopo bloqueado passam a falhar até que o limite seja aumentado ou o novo mês reinicie a
        contagem.
      </p>

      {dialog ? (
        <LimitDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onSave={(v) =>
            upsertMut.mutate({
              scope: dialog.scope,
              clientId: dialog.clientId ?? null,
              userId: dialog.userId ?? null,
              limitUsd: v.limitUsd,
              hardStop: v.hardStop,
              notifyAtPct: v.notifyAtPct,
            })
          }
          saving={upsertMut.isPending}
        />
      ) : null}
    </div>
  );
}

function LimitDialog({
  state,
  onClose,
  onSave,
  saving,
}: {
  state: LimitDialogState;
  onClose: () => void;
  onSave: (v: { limitUsd: number; hardStop: boolean; notifyAtPct: number }) => void;
  saving: boolean;
}) {
  const [limit, setLimit] = useState<string>(String(state.limitUsd ?? 0));
  const [hard, setHard] = useState<boolean>(state.hardStop);
  const [notify, setNotify] = useState<number>(state.notifyAtPct);
  const scopeLabel =
    state.scope === "brand" ? "Agência" : state.scope === "client" ? "Cliente" : "Usuário";
  return (
    <Dialog
      open={state.open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Definir limite · {scopeLabel}</DialogTitle>
          <DialogDescription className="truncate">{state.targetLabel}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="limit-usd">Limite mensal (USD)</Label>
            <Input
              id="limit-usd"
              type="number"
              min={0}
              step="0.01"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border/60 p-3">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Bloquear ao estourar</div>
              <div className="text-xs text-muted-foreground">
                Quando desativado, o consumo apenas emite alerta.
              </div>
            </div>
            <Switch checked={hard} onCheckedChange={setHard} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Notificar em</Label>
              <span className="text-xs tabular-nums text-muted-foreground">{notify}%</span>
            </div>
            <Slider
              value={[notify]}
              min={10}
              max={100}
              step={5}
              onValueChange={(v) => setNotify(v[0] ?? 80)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onSave({ limitUsd: Number(limit) || 0, hardStop: hard, notifyAtPct: notify })
            }
            disabled={saving}
          >
            {saving ? "Salvando…" : "Salvar limite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
