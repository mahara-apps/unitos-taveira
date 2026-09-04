import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, History, RotateCcw, Copy, Download, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpandedModal } from "@/components/ui/expanded-modal";
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
import {
  getStrategyRunFn,
  listStrategyRunsFn,
  restoreStrategyRunFn,
} from "@/lib/ai-agents.functions";
import { CUSTOMER_QUERY_KEYS } from "@/lib/customer-queries";

export type StrategyBlocks = {
  voice?: string;
  personas?: string;
  cohorts?: string;
  swot?: string;
};

export type StrategyRun = {
  key: string;
  createdAt: string;
  isActive: boolean;
  author: string | null;
  blocks: StrategyBlocks;
  models: Record<string, string> | null;
};

const BLOCK_LABEL: Record<keyof StrategyBlocks, string> = {
  voice: "Voz da marca",
  personas: "Personas",
  cohorts: "Cohorts",
  swot: "SWOT",
};

export function formatRunDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function useStrategyRuns(brandId: string, clientId: string) {
  const list = useServerFn(listStrategyRunsFn);
  return useQuery({
    queryKey: ["strategy-runs", brandId, clientId],
    queryFn: () => list({ data: { brandId, clientId } }) as Promise<StrategyRun[]>,
    staleTime: 30_000,
  });
}

/* ------------------------- read-only value rendering ----------------------- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function humanKey(k: string) {
  return k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function ReadOnlyValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="whitespace-pre-wrap text-foreground">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    const allScalar = value.every((v) => typeof v !== "object" || v === null);
    if (allScalar) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <Badge key={i} variant="secondary" className="font-normal">
              {String(v)}
            </Badge>
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {value.map((v, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <ReadOnlyValue value={v} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (isPlainObject(value)) {
    return (
      <div className="space-y-2">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="grid gap-1 sm:grid-cols-[minmax(9rem,14rem)_1fr] sm:gap-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {humanKey(k)}
            </div>
            <div className="text-sm">
              <ReadOnlyValue value={v} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

function toPlainText(label: string, value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined || value === "") return `${pad}${label}: —`;
  if (typeof value !== "object") return `${pad}${label}: ${String(value)}`;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== "object" || v === null)) {
      return `${pad}${label}: ${value.join(", ")}`;
    }
    return [
      `${pad}${label}:`,
      ...value.map((v, i) => toPlainText(`#${i + 1}`, v, indent + 1)),
    ].join("\n");
  }
  return [
    `${pad}${label}:`,
    ...Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      toPlainText(humanKey(k), v, indent + 1),
    ),
  ].join("\n");
}

function runToMarkdown(run: StrategyRun, payload: Record<string, unknown>) {
  const lines = [`# Estratégia IA — geração de ${formatRunDate(run.createdAt)}`, ""];
  for (const [block, label] of Object.entries(BLOCK_LABEL)) {
    const value = payload[block];
    if (value === undefined) continue;
    lines.push(`## ${label}`, "", toPlainText(label, value), "");
  }
  return lines.join("\n");
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  } catch {
    toast.error("Não foi possível copiar");
  }
}

/* --------------------------------- history -------------------------------- */

export function StrategyHistory({
  brandId,
  clientId,
  onRestored,
}: {
  brandId: string;
  clientId: string;
  onRestored?: () => void;
}) {
  const runsQ = useStrategyRuns(brandId, clientId);
  const [openRun, setOpenRun] = useState<StrategyRun | null>(null);
  const [confirmRun, setConfirmRun] = useState<StrategyRun | null>(null);
  const qc = useQueryClient();
  const restore = useServerFn(restoreStrategyRunFn);

  const restoreM = useMutation({
    mutationFn: (run: StrategyRun) => restore({ data: { brandId, clientId, blocks: run.blocks } }),
    onSuccess: () => {
      toast.success("Geração restaurada como versão ativa");
      const scope = { brandId, clientId };
      qc.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEYS.core(scope) });
      qc.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEYS.target(scope) });
      qc.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEYS.market(scope) });
      qc.invalidateQueries({ queryKey: ["strategy-runs", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["strategy-gate", brandId, clientId] });
      setOpenRun(null);
      setConfirmRun(null);
      onRestored?.();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao restaurar a geração"),
  });

  if (runsQ.isLoading) return <Skeleton className="h-48 w-full rounded-xl" />;

  const runs = runsQ.data ?? [];
  const history = runs.filter((r) => !r.isActive);

  if (!history.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <History className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhuma geração anterior ainda. Ao gerar inteligência novamente, a versão atual passa a
            ficar guardada aqui.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {history.map((run) => (
          <Card key={run.key} className="border-border/60">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatRunDate(run.createdAt)}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(Object.keys(BLOCK_LABEL) as Array<keyof StrategyBlocks>)
                    .filter((b) => run.blocks[b])
                    .map((b) => (
                      <Badge key={b} variant="outline" className="font-normal">
                        {BLOCK_LABEL[b]}
                      </Badge>
                    ))}
                  {run.author ? (
                    <span className="text-xs text-muted-foreground">· por {run.author}</span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpenRun(run)}>
                  Visualizar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  onClick={() => setConfirmRun(run)}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Restaurar
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <RunViewer
        brandId={brandId}
        clientId={clientId}
        run={openRun}
        onClose={() => setOpenRun(null)}
        onRestore={(run) => setConfirmRun(run)}
      />

      <AlertDialog open={!!confirmRun} onOpenChange={(o) => !o && setConfirmRun(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar esta geração?</AlertDialogTitle>
            <AlertDialogDescription>
              A geração de {confirmRun ? formatRunDate(confirmRun.createdAt) : ""} volta a ser a
              versão ativa do cliente. A versão atual não é apagada — ela passa para o histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmRun) restoreM.mutate(confirmRun);
              }}
              disabled={restoreM.isPending}
            >
              {restoreM.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RunViewer({
  brandId,
  clientId,
  run,
  onClose,
  onRestore,
}: {
  brandId: string;
  clientId: string;
  run: StrategyRun | null;
  onClose: () => void;
  onRestore: (run: StrategyRun) => void;
}) {
  const get = useServerFn(getStrategyRunFn);
  const q = useQuery({
    queryKey: ["strategy-run", brandId, clientId, run?.key],
    queryFn: () =>
      get({ data: { brandId, clientId, blocks: run!.blocks } }) as Promise<Record<string, unknown>>,
    enabled: !!run,
  });

  const payload = q.data ?? {};

  return (
    <ExpandedModal
      open={!!run}
      onOpenChange={(o) => !o && onClose()}
      size="xl"
      title={`Geração de ${run ? formatRunDate(run.createdAt) : ""}`}
      description="Versão somente leitura — não é a vigente deste cliente."
    >
      {run ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => copyText(runToMarkdown(run, payload), "Geração")}
            disabled={q.isLoading}
          >
            <Download className="h-3.5 w-3.5" /> Copiar tudo (Markdown)
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => onRestore(run)}>
            <RotateCcw className="h-3.5 w-3.5" /> Restaurar como ativa
          </Button>
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        {q.isLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : (
          (Object.keys(BLOCK_LABEL) as Array<keyof StrategyBlocks>)
            .filter((b) => payload[b] !== undefined && payload[b] !== null)
            .map((b) => (
              <section key={b} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold tracking-tight">{BLOCK_LABEL[b]}</h4>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() =>
                      copyText(toPlainText(BLOCK_LABEL[b], payload[b]), BLOCK_LABEL[b])
                    }
                  >
                    <Copy className="h-3 w-3" /> Copiar
                  </Button>
                </div>
                <div className="rounded-xl border border-border/60 bg-card p-4">
                  <ReadOnlyValue value={payload[b]} />
                </div>
              </section>
            ))
        )}
        {!q.isLoading &&
        !(Object.keys(BLOCK_LABEL) as Array<keyof StrategyBlocks>).some(
          (b) => payload[b] !== undefined && payload[b] !== null,
        ) ? (
          <p className="text-sm text-muted-foreground">Esta geração não tem conteúdo armazenado.</p>
        ) : null}
      </div>
    </ExpandedModal>
  );
}

export function ActiveRunMeta({ run }: { run: StrategyRun | undefined }) {
  if (!run) return null;
  const models = run.models ? Object.entries(run.models) : [];
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm">
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      <span className="font-medium">Gerada em {formatRunDate(run.createdAt)}</span>
      {run.author ? <span className="text-muted-foreground">· por {run.author}</span> : null}
      {models.length ? (
        <span className="flex flex-wrap items-center gap-1.5">
          {models.map(([step, model]) => (
            <Badge key={step} variant="outline" className="font-normal">
              {step}: {model}
            </Badge>
          ))}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">· provedor não registrado</span>
      )}
    </div>
  );
}
