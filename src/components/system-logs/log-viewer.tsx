import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Bell,
  Bot,
  CheckCircle2,
  ChevronDown,
  Copy,
  Info,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

import {
  listSystemLogs,
  type LogLevel,
  type LogSource,
  type SystemLogEntry,
} from "@/lib/logs.functions";
import { useActiveContext } from "@/hooks/use-active-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * LogViewer — visualizador único de logs do sistema.
 * Mesma consulta (`listSystemLogs`, admin-only no servidor) e mesmos filtros;
 * cada tela apenas restringe as ORIGENS que pode exibir:
 * - Settings → Auditoria: atividade humana + notificações;
 * - Centro de IA → Execuções: jobs de IA.
 */
export const SOURCE_META: Record<LogSource, { label: string; icon: typeof Bot; color: string }> = {
  ai_job: { label: "Jobs de IA", icon: Bot, color: "text-violet-500" },
  activity: { label: "Atividade", icon: Activity, color: "text-sky-500" },
  notification: { label: "Notificações", icon: Bell, color: "text-amber-500" },
};

const LEVEL_META: Record<
  LogLevel,
  {
    label: string;
    icon: typeof Info;
    className: string;
    badgeVariant: "destructive" | "default" | "secondary" | "outline";
  }
> = {
  error: {
    label: "Erro",
    icon: AlertCircle,
    className: "text-rose-500",
    badgeVariant: "destructive",
  },
  warn: {
    label: "Aviso",
    icon: AlertTriangle,
    className: "text-amber-500",
    badgeVariant: "default",
  },
  info: { label: "Info", icon: Info, className: "text-sky-500", badgeVariant: "secondary" },
  success: {
    label: "Sucesso",
    icon: CheckCircle2,
    className: "text-emerald-500",
    badgeVariant: "outline",
  },
};

export function LogViewer({
  sources: allowedSources,
  title,
  description,
  queryKey,
}: {
  /** Origens que esta tela pode exibir. */
  sources: LogSource[];
  title: string;
  description: string;
  /** Prefixo do cache (isola as telas). */
  queryKey: string;
}) {
  const { brandId, clientId } = useActiveContext();
  const load = useServerFn(listSystemLogs);

  const [levels, setLevels] = useState<Set<LogLevel>>(
    new Set(["error", "warn", "info", "success"]),
  );
  const [tab, setTab] = useState<"all" | LogSource>("all");
  const [search, setSearch] = useState("");
  const [scopeToClient, setScopeToClient] = useState(false);

  const sources: LogSource[] =
    tab === "all" || !allowedSources.includes(tab as LogSource)
      ? allowedSources
      : [tab as LogSource];

  const q = useQuery({
    queryKey: [
      queryKey,
      brandId,
      scopeToClient ? clientId : null,
      sources.join(","),
      Array.from(levels).sort().join(","),
      search,
    ],
    queryFn: () =>
      load({
        data: {
          brandId,
          clientId: scopeToClient ? clientId : null,
          sources,
          levels: Array.from(levels),
          search: search.trim() || undefined,
          limit: 300,
        },
      }),
    refetchOnWindowFocus: false,
  });

  const entries = useMemo(() => q.data ?? [], [q.data]);

  const counts = useMemo(() => {
    const c = { total: entries.length, error: 0, warn: 0, info: 0, success: 0 };
    for (const e of entries) c[e.level] += 1;
    return c;
  }, [entries]);

  const toggleLevel = (lv: LogLevel) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <PageKpiGrid columns={5}>
        <PageKpi label="Total" value={counts.total} status="neutral" />
        <PageKpi label="Erros" value={counts.error} status="danger" />
        <PageKpi label="Avisos" value={counts.warn} status="warning" />
        <PageKpi label="Info" value={counts.info} status="info" />
        <PageKpi label="Sucesso" value={counts.success} status="success" />
      </PageKpiGrid>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
              )}
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {allowedSources.length > 1 ? (
              <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
                <TabsList>
                  <TabsTrigger value="all">Todos</TabsTrigger>
                  {allowedSources.map((s) => (
                    <TabsTrigger key={s} value={s}>
                      {SOURCE_META[s].label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-2">
              {(Object.keys(LEVEL_META) as LogLevel[]).map((lv) => {
                const M = LEVEL_META[lv];
                return (
                  <Toggle
                    key={lv}
                    pressed={levels.has(lv)}
                    onPressedChange={() => toggleLevel(lv)}
                    size="sm"
                    aria-label={M.label}
                    className="gap-1.5 data-[state=on]:bg-muted"
                  >
                    <M.icon className={`h-3.5 w-3.5 ${M.className}`} />
                    <span className="text-xs">{M.label}</span>
                  </Toggle>
                );
              })}
              {clientId ? (
                <Toggle
                  pressed={scopeToClient}
                  onPressedChange={setScopeToClient}
                  size="sm"
                  className="text-xs data-[state=on]:bg-muted"
                >
                  Só este cliente
                </Toggle>
              ) : null}
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por texto, ID ou mensagem…"
              className="pl-9"
            />
          </div>

          {q.isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed">
              <Info className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nenhum log encontrado com os filtros atuais.
              </p>
            </div>
          ) : (
            <ScrollArea className="max-h-[65vh] rounded-lg border">
              <ul className="divide-y">
                {entries.map((e) => (
                  <LogRow key={e.id} entry={e} />
                ))}
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogRow({ entry }: { entry: SystemLogEntry }) {
  const [open, setOpen] = useState(false);
  const L = LEVEL_META[entry.level];
  const S = SOURCE_META[entry.source];
  const hasDetails = Object.keys(entry.meta ?? {}).length > 0;
  const ts = entry.timestamp ? new Date(entry.timestamp) : null;

  return (
    <li className="px-3 py-2.5 text-sm hover:bg-muted/40">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-start gap-3">
          <L.icon className={`mt-0.5 h-4 w-4 shrink-0 ${L.className}`} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-medium">{entry.title}</span>
              <Badge
                variant="outline"
                className="gap-1 border-border/70 px-1.5 py-0 text-[10px] font-normal"
              >
                <S.icon className={`h-2.5 w-2.5 ${S.color}`} />
                {S.label}
              </Badge>
              <Badge variant={L.badgeVariant} className="px-1.5 py-0 text-[10px] font-normal">
                {L.label}
              </Badge>
            </div>
            {entry.subtitle ? (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{entry.subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-[11px] text-muted-foreground">
              {ts ? formatDistanceToNow(ts, { addSuffix: true, locale: ptBR }) : "—"}
            </span>
            {hasDetails ? (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px]">
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                  Detalhes
                </Button>
              </CollapsibleTrigger>
            ) : null}
          </div>
        </div>
        <CollapsibleContent className="mt-2 pl-7">
          <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-1.5">
            <span className="font-mono text-[10px] text-muted-foreground">{entry.id}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px]"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
                toast.success("Log copiado");
              }}
            >
              <Copy className="h-3 w-3" /> Copiar JSON
            </Button>
          </div>
          <pre className="mt-2 max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(entry.meta, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
