import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarClock,
  Download,
  Laptop,
  Loader2,
  ShieldAlert,
  Smartphone,
  Users,
} from "lucide-react";

import { useActiveContext } from "@/hooks/use-active-context";
import { listLoginActivityFn } from "@/lib/login-audit.functions";
import { toCsv, type LoginEventRow, type LoginPersonSummary } from "@/lib/login-audit";
import { formatDateTimeBr } from "@/lib/timezone";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const PERIODS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "180", label: "180 dias" },
];

type KindFilter = "all" | "team" | "portal_client";

export function AccessLogView() {
  const { brandId } = useActiveContext();
  const [days, setDays] = useState("30");
  const [kind, setKind] = useState<KindFilter>("all");
  const [search, setSearch] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [tab, setTab] = useState<"people" | "events">("people");

  const listActivity = useServerFn(listLoginActivityFn);

  const query = useQuery({
    queryKey: ["login-activity", brandId, days, kind, search, onlyFailed],
    enabled: Boolean(brandId),
    staleTime: 60_000,
    queryFn: () =>
      listActivity({
        data: {
          brandId: brandId!,
          days: Number(days),
          kind: kind === "all" ? null : kind,
          onlyFailed,
          search: search.trim() || undefined,
        },
      }),
  });

  const data = query.data;

  function exportCsv() {
    if (!data) return;
    const csv = toCsv(data.events, (iso) => formatDateTimeBr(iso));
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `acessos-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageKpiGrid columns={5}>
        <PageKpi
          icon={<CalendarClock />}
          label="Ativos hoje"
          value={data ? data.summary.activeToday : "—"}
          status="info"
          description="Pessoas que entraram hoje"
        />
        <PageKpi
          icon={<Users />}
          label="Ativos em 7 dias"
          value={data ? data.summary.active7d : "—"}
          description="Pessoas distintas"
        />
        <PageKpi
          icon={<Users />}
          label="Ativos em 30 dias"
          value={data ? data.summary.active30d : "—"}
          description="Pessoas distintas"
        />
        <PageKpi
          icon={<Laptop />}
          label="Entradas no período"
          value={data ? data.summary.totalSignIns : "—"}
          status="success"
          description={`Últimos ${days} dias`}
        />
        <PageKpi
          icon={<ShieldAlert />}
          label="Tentativas falhas"
          value={data ? data.summary.failed : "—"}
          status={data && data.summary.failed > 0 ? "warning" : "neutral"}
          description="Senha incorreta"
          onClick={() => setOnlyFailed((v) => !v)}
          active={onlyFailed}
        />
      </PageKpiGrid>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-base">Acessos ao sistema</CardTitle>
              <CardDescription>
                Frequência de entrada da equipe e dos clientes do portal. Datas no fuso de Brasília.
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou e-mail"
                className="h-9 w-full sm:w-56"
              />
              <Select value={kind} onValueChange={(v) => setKind(v as KindFilter)}>
                <SelectTrigger className="h-9 w-full sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Equipe e clientes</SelectItem>
                  <SelectItem value="team">Somente equipe</SelectItem>
                  <SelectItem value="portal_client">Somente clientes</SelectItem>
                </SelectContent>
              </Select>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="h-9 w-full sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={!data || data.events.length === 0}
              >
                <Download className="mr-1.5 h-4 w-4" />
                CSV
              </Button>
            </div>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as "people" | "events")}>
            <TabsList>
              <TabsTrigger value="people">Por pessoa</TabsTrigger>
              <TabsTrigger value="events">Histórico detalhado</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {!brandId ? (
            <EmptyState text="Selecione um workspace para ver os acessos." />
          ) : query.isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : query.isError ? (
            <EmptyState
              icon={<AlertTriangle className="h-5 w-5 text-severity-warning" />}
              text={
                query.error instanceof Error
                  ? query.error.message
                  : "Não foi possível carregar os acessos."
              }
            />
          ) : tab === "people" ? (
            <PeopleTable people={data?.people ?? []} />
          ) : (
            <EventsTable events={data?.events ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
      {icon}
      <p className="max-w-md">{text}</p>
    </div>
  );
}

function KindBadge({ kind, clientName }: { kind: string; clientName: string | null }) {
  if (kind === "portal_client") {
    return (
      <Badge variant="outline" className="border-severity-info/40 text-severity-info">
        Cliente{clientName ? ` · ${clientName}` : ""}
      </Badge>
    );
  }
  return <Badge variant="secondary">Equipe</Badge>;
}

function Sparkline({ daily }: { daily: { date: string; count: number }[] }) {
  if (daily.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const max = Math.max(...daily.map((d) => d.count), 1);
  return (
    <span className="flex h-6 items-end gap-0.5">
      {daily.slice(-30).map((d) => (
        <Tooltip key={d.date}>
          <TooltipTrigger asChild>
            <span
              className="w-1 rounded-sm bg-primary/70"
              style={{ height: `${Math.max(12, (d.count / max) * 100)}%` }}
            />
          </TooltipTrigger>
          <TooltipContent>
            {d.count} acesso{d.count === 1 ? "" : "s"} em {d.date.split("-").reverse().join("/")}
          </TooltipContent>
        </Tooltip>
      ))}
    </span>
  );
}

function PeopleTable({ people }: { people: LoginPersonSummary[] }) {
  const rows = useMemo(() => people, [people]);
  if (rows.length === 0) return <EmptyState text="Nenhuma pessoa encontrada com esses filtros." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Pessoa</th>
            <th className="py-2 pr-3 font-medium">Tipo</th>
            <th className="py-2 pr-3 font-medium">Último acesso</th>
            <th className="py-2 pr-3 text-right font-medium">Acessos</th>
            <th className="py-2 pr-3 font-medium">Dispositivo</th>
            <th className="py-2 font-medium">Frequência</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.userId ?? p.email ?? p.name} className="border-b border-border/40">
              <td className="py-2.5 pr-3">
                <div className="font-medium text-foreground">{p.name}</div>
                <div className="truncate text-xs text-muted-foreground">{p.email ?? "—"}</div>
              </td>
              <td className="py-2.5 pr-3">
                <KindBadge kind={p.kind} clientName={p.clientName} />
              </td>
              <td className="py-2.5 pr-3">
                {p.lastSignInAt ? (
                  formatDateTimeBr(p.lastSignInAt)
                ) : (
                  <span className="text-xs text-muted-foreground">Sem acesso</span>
                )}
              </td>
              <td className="py-2.5 pr-3 text-right tabular-nums">
                {p.signIns}
                {p.failed > 0 ? (
                  <span className="ml-1.5 text-xs text-severity-warning">({p.failed} falhas)</span>
                ) : null}
              </td>
              <td className="py-2.5 pr-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  {p.topDevice === "Celular" ? (
                    <Smartphone className="h-3.5 w-3.5" />
                  ) : p.topDevice ? (
                    <Laptop className="h-3.5 w-3.5" />
                  ) : null}
                  {p.topDevice ?? "—"}
                </span>
              </td>
              <td className="py-2.5">
                <Sparkline daily={p.daily} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventsTable({ events }: { events: LoginEventRow[] }) {
  if (events.length === 0) return <EmptyState text="Nenhum acesso registrado nesse período." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Data e hora</th>
            <th className="py-2 pr-3 font-medium">Pessoa</th>
            <th className="py-2 pr-3 font-medium">Tipo</th>
            <th className="py-2 pr-3 font-medium">Resultado</th>
            <th className="py-2 pr-3 font-medium">Dispositivo</th>
            <th className="py-2 font-medium">Local aproximado</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b border-border/40">
              <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums">
                {formatDateTimeBr(e.created_at)}
              </td>
              <td className="py-2.5 pr-3">
                <div className="font-medium text-foreground">{e.person_name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {e.person_email ?? e.email ?? "—"}
                </div>
              </td>
              <td className="py-2.5 pr-3">
                <KindBadge kind={e.kind} clientName={e.client_name} />
              </td>
              <td className="py-2.5 pr-3">
                {e.event === "failed" ? (
                  <Badge variant="outline" className="border-severity-warning/40 text-severity-warning">
                    Falhou
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-health-good/40 text-health-good">
                    Entrou
                  </Badge>
                )}
              </td>
              <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                {[e.device, e.os, e.browser].filter(Boolean).join(" · ") || "—"}
              </td>
              <td className="py-2.5 text-xs text-muted-foreground">
                {[e.city, e.country].filter(Boolean).join(", ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
