// Dashboard de pautas: ativas por padrão, hierarquia Projeto → Tarefa → Pauta,
// arquivamento reversível e ações contextuais coerentes com o estado do item.
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArchiveRestore,
  Archive,
  ArrowRight,
  CheckCircle2,
  FolderKanban,
  ListChecks,
  MoreHorizontal,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PLAN_STATUS_META } from "@/lib/monthly-plan-status";
import { describeError } from "@/lib/errors";
import {
  archiveMonthlyPlanFn,
  deleteMonthlyPlanFn,
  listPlanBoardFn,
  restoreMonthlyPlanFn,
  type PlanArchiveFilter,
  type PlanBoardItem,
} from "@/lib/monthly-plans.functions";
import { LinkPautaProjectDialog } from "@/components/monthly-plan/new-pauta-dialog";

/** Mensagens de negócio da exclusão definitiva. */
export function describePlanDeleteError(e: unknown): string {
  const m = describeError(e);
  if (m.includes("plan_has_content"))
    return "Esta pauta já gerou peças de conteúdo. Arquive-a para preservar o histórico.";
  if (m.includes("forbidden"))
    return "Somente Owner, Admin ou Super Admin podem excluir pautas.";
  if (m.includes("plan_not_found")) return "Pauta não encontrada neste cliente.";
  return `Não foi possível excluir: ${m}`;
}

const ARCHIVE_TABS: Array<{ key: PlanArchiveFilter; label: string }> = [
  { key: "active", label: "Ativas" },
  { key: "archived", label: "Arquivadas" },
  { key: "all", label: "Todas" },
];


export function PautaBoard({
  brandId,
  clientId,
  onOpen,
  onNewPauta,
  onGenerateWithAi,
  canGenerate,
}: {
  brandId: string;
  clientId: string;
  onOpen: (planId: string) => void;
  onNewPauta: () => void;
  onGenerateWithAi?: () => void;
  canGenerate?: boolean;
}) {
  const [archive, setArchive] = React.useState<PlanArchiveFilter>("active");
  const [projectFilter, setProjectFilter] = React.useState<string>("all");
  const [q, setQ] = React.useState("");
  const [linkTarget, setLinkTarget] = React.useState<PlanBoardItem | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<PlanBoardItem | null>(null);

  const list = useServerFn(listPlanBoardFn);
  const boardQ = useQuery({
    queryKey: ["plan-board", brandId, clientId, archive, projectFilter, q],
    queryFn: () =>
      list({
        data: {
          brandId,
          clientId,
          archive,
          projectId: projectFilter === "all" || projectFilter === "none" ? null : projectFilter,
          withoutProject: projectFilter === "none",
          q: q.trim() || undefined,
        },
      }),
    staleTime: 15_000,
  });

  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["plan-board", brandId, clientId] });
    qc.invalidateQueries({ queryKey: ["monthly-plans", "list", brandId, clientId] });
  };

  const archiveFn = useServerFn(archiveMonthlyPlanFn);
  const restoreFn = useServerFn(restoreMonthlyPlanFn);
  const archiveM = useMutation({
    mutationFn: (planId: string) => archiveFn({ data: { planId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Pauta arquivada. O histórico foi preservado.");
    },
    onError: (e) => toast.error(`Não foi possível arquivar: ${describeError(e)}`),
  });
  const restoreM = useMutation({
    mutationFn: (planId: string) => restoreFn({ data: { planId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Pauta restaurada para a operação ativa.");
    },
    onError: (e) => toast.error(`Não foi possível restaurar: ${describeError(e)}`),
  });

  const deleteFn = useServerFn(deleteMonthlyPlanFn);
  const deleteM = useMutation({
    mutationFn: (planId: string) => deleteFn({ data: { planId, brandId, clientId } }),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
      toast.success("Pauta excluída definitivamente.");
    },
    onError: (e) => toast.error(describePlanDeleteError(e)),
  });

  const summary = boardQ.data?.summary;
  const projects = boardQ.data?.projects ?? [];
  const items = boardQ.data?.items ?? [];
  const canDelete = boardQ.data?.canDelete ?? false;
  const busy = archiveM.isPending || restoreM.isPending || deleteM.isPending;


  return (
    <section className="mt-8 space-y-3">
      {/* Cabeçalho + contadores reais */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Pautas deste cliente</h2>
          <p className="text-xs text-muted-foreground">
            A pauta é a unidade editorial. O projeto é a iniciativa que a agrupa.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onGenerateWithAi && (
            <Button
              variant="ai"
              size="sm"
              className="h-8 gap-1.5"
              disabled={canGenerate === false}
              onClick={onGenerateWithAi}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Gerar com IA
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8" onClick={onNewPauta}>
            Nova pauta
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryCell label="Ativas" value={summary.active} />
          <SummaryCell label="Em produção" value={summary.inProduction} />
          <SummaryCell label="No cliente" value={summary.withClient} />
          <SummaryCell label="Arquivadas" value={summary.archived} muted />
        </div>
      )}

      {/* Filtros essenciais */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-border/60 p-0.5">
          {ARCHIVE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setArchive(t.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                archive === t.key
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-8 w-[210px] text-xs">
            <SelectValue placeholder="Todos os projetos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os projetos</SelectItem>
            <SelectItem value="none">Sem projeto</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.status === "archived" ? " (arquivado)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex h-8 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border/60 px-2.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar pauta"
            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Lista */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
        {boardQ.isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : boardQ.isError ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <p className="text-sm font-medium">Não foi possível carregar as pautas</p>
            <Button size="sm" variant="outline" onClick={() => boardQ.refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
            <p className="text-sm font-medium">
              {archive === "archived"
                ? "Nenhuma pauta arquivada"
                : q || projectFilter !== "all"
                  ? "Nenhuma pauta com esses filtros"
                  : "Nenhuma pauta ativa"}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {archive === "archived"
                ? "Pautas arquivadas continuam preservadas e aparecem aqui."
                : "Crie uma pauta manualmente ou gere a pauta do mês com IA."}
            </p>
            {archive !== "archived" && (
              <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={onNewPauta}>
                Nova pauta
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {items.map((p) => (
              <PautaRow
                key={p.id}
                item={p}
                busy={busy}
                canDelete={canDelete}
                onOpen={() => onOpen(p.id)}
                onArchive={() => archiveM.mutate(p.id)}
                onRestore={() => restoreM.mutate(p.id)}
                onLinkProject={() => setLinkTarget(p)}
                onDelete={() => setDeleteTarget(p)}
              />
            ))}
          </ul>
        )}
      </div>

      {linkTarget && (
        <LinkPautaProjectDialog
          open={!!linkTarget}
          onOpenChange={(o) => !o && setLinkTarget(null)}
          brandId={brandId}
          clientId={clientId}
          planId={linkTarget.id}
          planTitle={linkTarget.title}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta pauta definitivamente?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” e todos os seus itens serão apagados. Esta ação é
              irreversível. O projeto vinculado é preservado. Pautas que já geraram peças de
              conteúdo não podem ser excluídas — arquive-as.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteM.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteM.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteM.mutate(deleteTarget.id);
              }}
            >
              {deleteM.isPending ? "Excluindo…" : "Excluir definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function SummaryCell({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-3 py-2">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-xl font-semibold leading-none tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function PautaRow({
  item,
  busy,
  canDelete,
  onOpen,
  onArchive,
  onRestore,
  onLinkProject,
  onDelete,
}: {
  item: PlanBoardItem;
  busy: boolean;
  canDelete: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onLinkProject: () => void;
  onDelete: () => void;
}) {
  const meta = PLAN_STATUS_META[item.status] ?? PLAN_STATUS_META.draft;
  const archived = item.status === "archived";

  return (
    <li
      className={cn(
        "group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40",
        archived && "opacity-70",
      )}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <span
            className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-medium uppercase tracking-wide ${meta.cls}`}
          >
            {meta.label}
          </span>
        </div>

        {/* Hierarquia: Projeto → Tarefa */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <FolderKanban className="h-3 w-3" />
            {item.project ? (
              <>
                {item.project.name}
                {item.project.status === "archived" && (
                  <span className="rounded bg-muted px-1 text-[10px]">projeto arquivado</span>
                )}
              </>
            ) : (
              <span className="italic">Sem projeto</span>
            )}
          </span>
          {item.tasks.total > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <ListChecks className="h-3 w-3" />
              {item.tasks.primary
                ? `${item.tasks.primary}${item.tasks.total > 1 ? ` +${item.tasks.total - 1}` : ""}`
                : `${item.tasks.total} tarefas`}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3" />
            {item.topics_count} {item.topics_count === 1 ? "item" : "itens"}
            {item.topics_approved > 0 && ` · ${item.topics_approved} aprovados`}
            {item.posts_count > 0 && ` · ${item.posts_count} em conteúdo`}
          </span>
          <span>{item.author_name ?? "—"}</span>
          <span className="tabular-nums">
            {new Date(item.created_at).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={busy}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onOpen}>
            <ArrowRight className="mr-2 h-3.5 w-3.5" /> Abrir
          </DropdownMenuItem>
          {!archived && (
            <DropdownMenuItem onSelect={onLinkProject}>
              <FolderKanban className="mr-2 h-3.5 w-3.5" />
              {item.project ? "Trocar projeto" : "Vincular projeto"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {archived ? (
            <DropdownMenuItem onSelect={onRestore}>
              <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restaurar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onArchive}>
              <Archive className="mr-2 h-3.5 w-3.5" /> Arquivar
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onDelete}
                disabled={item.posts_count > 0}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                {item.posts_count > 0 ? "Excluir (bloqueado)" : "Excluir definitivamente"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
