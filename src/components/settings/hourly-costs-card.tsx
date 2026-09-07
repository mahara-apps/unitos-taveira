import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/identity";
import { listBrandTeam } from "@/lib/team.functions";
import {
  listMemberHourlyCostsFn,
  setMemberHourlyCostFn,
} from "@/lib/timesheet-report.functions";

/** Valor/hora por pessoa — base do custo no relatório de Timesheet. */
export function HourlyCostsCard({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const teamFn = useServerFn(listBrandTeam);
  const listFn = useServerFn(listMemberHourlyCostsFn);
  const saveFn = useServerFn(setMemberHourlyCostFn);

  const teamQ = useQuery({
    enabled: !!brandId,
    queryKey: ["brand-team", brandId],
    queryFn: () => teamFn({ data: { brandId } }),
  });
  const costsQ = useQuery({
    enabled: !!brandId,
    queryKey: ["member-hourly-costs", brandId],
    queryFn: () => listFn({ data: { brandId } }),
    retry: 0,
  });

  const costById = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of costsQ.data?.costs ?? []) map.set(c.userId, c.hourlyCostCents);
    return map;
  }, [costsQ.data]);

  const members = useMemo(
    () => (teamQ.data?.members ?? []),
    [teamQ.data],
  );

  const save = useMutation({
    mutationFn: (v: { userId: string; hourlyCostCents: number }) =>
      saveFn({ data: { brandId, ...v } }),
    onSuccess: () => {
      toast.success("Valor por hora atualizado.");
      qc.invalidateQueries({ queryKey: ["member-hourly-costs", brandId] });
      qc.invalidateQueries({ queryKey: ["timesheet-report"] });
      qc.invalidateQueries({ queryKey: ["timesheet-project"] });
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  if (costsQ.isError) return null; // sem permissão para ver custos

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Valor por hora da equipe</CardTitle>
        <CardDescription>
          Usado para calcular o custo das horas apontadas em Análises › Timesheet. Somente
          administradores veem e alteram estes valores.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {teamQ.isLoading || costsQ.isLoading ? (
          <div className="space-y-2 p-6">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : members.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nenhum membro ativo.</p>
        ) : (
          <ul>
            {members.map((m) => (
              <CostRow
                key={m.user_id}
                name={displayName({ full_name: m.full_name, email: m.email })}
                email={m.email ?? null}
                avatarUrl={m.avatar_url ?? null}
                cents={costById.get(m.user_id) ?? 0}
                saving={save.isPending && save.variables?.userId === m.user_id}
                onSave={(cents) => save.mutate({ userId: m.user_id, hourlyCostCents: cents })}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CostRow({
  name,
  email,
  avatarUrl,
  cents,
  saving,
  onSave,
}: {
  name: string;
  email: string | null;
  avatarUrl: string | null;
  cents: number;
  saving: boolean;
  onSave: (cents: number) => void;
}) {
  const [value, setValue] = useState(() => (cents / 100).toFixed(2).replace(".", ","));
  useEffect(() => {
    setValue((cents / 100).toFixed(2).replace(".", ","));
  }, [cents]);

  const parsed = Math.round(Number(value.replace(/\./g, "").replace(",", ".")) * 100);
  const valid = Number.isFinite(parsed) && parsed >= 0;
  const dirty = valid && parsed !== cents;

  return (
    <li className="flex items-center gap-3 border-b border-border/60 px-6 py-3 last:border-b-0">
      <Avatar className="h-8 w-8">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback className="text-[10px]">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate text-xs text-muted-foreground">{email ?? "—"}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">R$</span>
        <Input
          value={value}
          inputMode="decimal"
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-24 text-right tabular-nums"
          aria-label={`Valor por hora de ${name}`}
        />
        <span className="text-[11px] text-muted-foreground">/h</span>
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          disabled={!dirty || saving}
          onClick={() => onSave(parsed)}
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </li>
  );
}
