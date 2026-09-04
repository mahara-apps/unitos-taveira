import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock,
  FileText,
  History,
  Loader2,
  Sparkles,
  User,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getBriefingImportRun,
  listBriefingImportRuns,
  type ImportRunListItem,
} from "@/lib/briefing-import.functions";
import type { ImportRunStatus } from "@/lib/briefing-import.server";
import { ChangeCard } from "@/components/brand-hub/briefing-import-dialog";
import {
  RUN_STATUS_LABELS,
  SOURCE_KIND_LABELS,
  STEP_LABELS,
  isReviewable,
  shouldPollRun,
} from "@/lib/briefing-import-ui";

/**
 * Histórico de importações com IA — escopo estrito de brand + cliente ativos
 * (a RLS das tabelas de import repete a mesma regra no servidor).
 */

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function statusBadge(status: ImportRunStatus) {
  const label = RUN_STATUS_LABELS[status];
  if (status === "applied")
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      >
        <CheckCircle2 className="mr-1 h-3 w-3" /> {label}
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
        <XCircle className="mr-1 h-3 w-3" /> {label}
      </Badge>
    );
  if (status === "queued" || status === "running" || status === "applying")
    return (
      <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> {label}
      </Badge>
    );
  if (status === "proposed")
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Clock className="mr-1 h-3 w-3" /> {label}
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {label}
    </Badge>
  );
}

export function BriefingImportHistory({
  brandId,
  clientId,
}: {
  brandId: string;
  clientId: string;
}) {
  const list = useServerFn(listBriefingImportRuns);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ImportRunStatus>("all");
  const [openRun, setOpenRun] = useState<ImportRunListItem | null>(null);
  const [expanded, setExpanded] = useState(false);

  const runsQ = useQuery({
    queryKey: ["briefing-import-runs", brandId, clientId],
    queryFn: () => list({ data: { brandId, clientId, limit: 50 } }),
    refetchInterval: (q) => {
      const rows = (q.state.data ?? []) as ImportRunListItem[];
      return rows.some((r) => shouldPollRun(r.status)) ? 4000 : false;
    },
  });

  const total = runsQ.data?.length ?? 0;

  const rows = useMemo(() => {
    const all = runsQ.data ?? [];
    const term = search.trim().toLowerCase();
    return all.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (!term) return true;
      return [r.document_name, r.author_name, r.summary, r.model]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
    });
  }, [runsQ.data, search, status]);

  return (
    <Card className="border-border/60 bg-muted/10">
      <CardHeader className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 space-y-0 px-4 py-3">
        <div className="min-w-0">
          <CardTitle className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
            <History className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Importações com IA</span>
            {total > 0 ? (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {total}
              </Badge>
            ) : null}
          </CardTitle>
          {!expanded ? (
            <CardDescription className="mt-0.5 truncate text-[11px]">
              Cada execução guarda o material enviado, a proposta e o que foi aplicado.
            </CardDescription>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 text-[11px]"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Ocultar" : "Ver histórico"}
        </Button>
      </CardHeader>
      {expanded ? (
        <CardContent className="space-y-3 border-t border-border/60 px-4 py-4">
          <div className="flex flex-wrap gap-2">

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por arquivo, usuário ou resumo"
            className="h-8 max-w-xs text-xs"
          />
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              {(Object.keys(RUN_STATUS_LABELS) as ImportRunStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {RUN_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {runsQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
            Nenhuma importação por IA registrada para este cliente.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpenRun(r)}
                  className={cn(
                    "w-full rounded-lg border border-border/60 px-3 py-3 text-left transition hover:border-primary/40 hover:bg-muted/30",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">
                      {r.document_name ?? "Material sem nome"}
                    </span>
                    {statusBadge(r.status)}
                    <Badge variant="outline" className="text-[11px] text-muted-foreground">
                      {SOURCE_KIND_LABELS[r.source_kind]}
                    </Badge>
                    {r.applied_version_id ? (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 text-[11px] text-emerald-600 dark:text-emerald-400"
                      >
                        Aplicado ao briefing
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {fmtDate(r.created_at)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" /> {r.author_name ?? "—"}
                    </span>
                    <span>
                      {r.counts.created + r.counts.updated} alteraç
                      {r.counts.created + r.counts.updated === 1 ? "ão" : "ões"} proposta
                      {r.counts.created + r.counts.updated === 1 ? "" : "s"}
                    </span>
                    {r.model ? <span>{r.model}</span> : null}
                    {r.provider ? <span>{r.provider}</span> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        </CardContent>
      ) : null}


      <ImportRunDetail
        brandId={brandId}
        clientId={clientId}
        run={openRun}
        onClose={() => setOpenRun(null)}
      />
    </Card>
  );
}

function ImportRunDetail({
  brandId,
  clientId,
  run,
  onClose,
}: {
  brandId: string;
  clientId: string;
  run: ImportRunListItem | null;
  onClose: () => void;
}) {
  const getRun = useServerFn(getBriefingImportRun);
  const detailQ = useQuery({
    queryKey: ["briefing-import-run", brandId, clientId, run?.id ?? "none"],
    enabled: !!run,
    queryFn: () => getRun({ data: { brandId, clientId, runId: run!.id } }),
  });

  const data = detailQ.data;
  const changes = data?.changes ?? [];

  return (
    <ExpandedModal
      open={!!run}
      onOpenChange={(v) => (!v ? onClose() : undefined)}
      size="lg"
      title="Detalhe da importação"
      description={run ? `${run.document_name ?? "Material"} · ${fmtDate(run.created_at)}` : ""}
      headerExtra={run ? statusBadge(run.status) : null}
    >
      {detailQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : !data?.run ? (
        <p className="text-xs text-muted-foreground">Execução não encontrada.</p>
      ) : (
        <div className="space-y-5">
          <dl className="grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Origem</dt>
              <dd>{SOURCE_KIND_LABELS[data.run.source_kind]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Iniciado por</dt>
              <dd>{run?.author_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Modelo / provedor</dt>
              <dd>
                {data.run.model ?? "—"}
                {data.run.provider ? ` · ${data.run.provider}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Versão gerada</dt>
              <dd className="font-mono text-[11px]">
                {data.run.applied_version_id ?? "— não aplicada —"}
              </dd>
            </div>
          </dl>

          {data.run.summary ? (
            <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs">
              {data.run.summary}
            </p>
          ) : null}

          {data.run.error ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {data.run.error}
            </p>
          ) : null}

          <div>
            <h4 className="mb-2 text-xs font-medium">Etapas</h4>
            <ul className="space-y-1.5 text-[11px]">
              {data.steps.length === 0 ? (
                <li className="text-muted-foreground">Sem etapas registradas.</li>
              ) : (
                data.steps.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      {s.status === "done" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : s.status === "failed" ? (
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {STEP_LABELS[s.step] ?? s.step}
                    </span>
                    <span className="text-muted-foreground">
                      {s.duration_ms != null ? `${Math.round(s.duration_ms / 100) / 10}s` : "—"}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium">
              Alterações propostas ({changes.filter((c) => isReviewable(c.action)).length})
            </h4>
            <div className="space-y-2">
              {changes.filter((c) => isReviewable(c.action)).length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma alteração real foi proposta nesta execução.
                </p>
              ) : (
                changes
                  .filter((c) => isReviewable(c.action))
                  .map((c) => <ChangeCard key={c.id} change={c} readOnly />)
              )}
            </div>
          </div>
        </div>
      )}
    </ExpandedModal>
  );
}
