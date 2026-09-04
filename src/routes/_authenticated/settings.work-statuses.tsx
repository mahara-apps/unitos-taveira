/**
 * Cadastro de status de trabalho por escopo (projeto / job / tarefa).
 * Sem status cadastrados, as telas continuam usando os status embutidos.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { DashboardPageShell, DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import {
  WORK_STATUS_SCOPES,
  createWorkStatusFn,
  deleteWorkStatusFn,
  listWorkStatusesFn,
  updateWorkStatusFn,
  type WorkStatus,
  type WorkStatusScope,
} from "@/lib/work-statuses.functions";

export const Route = createFileRoute("/_authenticated/settings/work-statuses")({
  component: WorkStatusesPage,
  head: () => ({
    meta: [
      { title: "Status de trabalho · Unitos" },
      {
        name: "description",
        content:
          "Cadastre os status usados em projetos, jobs e tarefas da sua workspace no Unitos.",
      },
      { property: "og:title", content: "Status de trabalho · Unitos" },
      {
        property: "og:description",
        content: "Configure status próprios para projetos, jobs e tarefas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const SCOPE_LABEL: Record<WorkStatusScope, string> = {
  project: "Projetos",
  job: "Jobs",
  task: "Tarefas",
};

const DEFAULT_COLOR = "#8b5cf6";

/** Conjuntos sugeridos, diferentes por escopo — criados só quando o usuário pede. */
const SCOPE_PRESETS: Record<
  WorkStatusScope,
  Array<{ name: string; color: string; isDone?: boolean }>
> = {
  project: [
    { name: "Não iniciado", color: "#9ca3af" },
    { name: "Em planejamento/briefing", color: "#a78bfa" },
    { name: "Campanha ativa", color: "#86c887" },
    { name: "Campanha pausada", color: "#d9c65c" },
    { name: "Concluído", color: "#22c55e", isDone: true },
    { name: "Cancelado", color: "#ef4444", isDone: true },
  ],
  job: [
    { name: "Não iniciado", color: "#9ca3af" },
    { name: "Em produção", color: "#e0a458" },
    { name: "Em revisão", color: "#a78bfa" },
    { name: "Aprovado", color: "#86c887" },
    { name: "Entregue", color: "#22c55e", isDone: true },
  ],
  task: [
    { name: "A fazer", color: "#9ca3af" },
    { name: "Em andamento", color: "#e0a458" },
    { name: "Aguardando cliente", color: "#a78bfa" },
    { name: "Bloqueado", color: "#ef4444" },
    { name: "Concluída", color: "#22c55e", isDone: true },
  ],
};

function ScopeSection({ brandId, scope }: { brandId: string; scope: WorkStatusScope }) {
  const qc = useQueryClient();
  const list = useServerFn(listWorkStatusesFn);
  const create = useServerFn(createWorkStatusFn);
  const update = useServerFn(updateWorkStatusFn);
  const remove = useServerFn(deleteWorkStatusFn);

  const key = ["work-statuses", brandId, scope] as const;
  const q = useQuery({ queryKey: key, queryFn: () => list({ data: { brandId, scope } }) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["work-statuses"] });

  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [isDone, setIsDone] = useState(false);

  const createMut = useMutation({
    mutationFn: () => create({ data: { brandId, scope, name: name.trim(), color, isDone } }),
    onSuccess: () => {
      setName("");
      setColor(DEFAULT_COLOR);
      setIsDone(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const patchMut = useMutation({
    mutationFn: (v: { statusId: string; patch: Record<string, unknown> }) =>
      update({ data: { brandId, statusId: v.statusId, patch: v.patch as never } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const delMut = useMutation({
    mutationFn: (statusId: string) => remove({ data: { brandId, statusId } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const statuses = (q.data ?? []) as WorkStatus[];

  const presetMut = useMutation({
    mutationFn: async () => {
      for (const p of SCOPE_PRESETS[scope]) {
        await create({
          data: { brandId, scope, name: p.name, color: p.color, isDone: p.isDone ?? false },
        });
      }
    },
    onSuccess: () => {
      toast.success(`Conjunto sugerido criado para ${SCOPE_LABEL[scope].toLowerCase()}.`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Troca a posição com o vizinho, mantendo a ordem exibida no seletor. */
  const moveMut = useMutation({
    mutationFn: async (v: { index: number; dir: -1 | 1 }) => {
      const a = statuses[v.index];
      const b = statuses[v.index + v.dir];
      if (!a || !b) return;
      await update({
        data: { brandId, statusId: a.id, patch: { position: b.position } as never },
      });
      await update({
        data: { brandId, statusId: b.id, patch: { position: a.position } as never },
      });
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <DashboardPanelSurface className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-background/40 px-4 py-2.5">
        <h2 className="font-mono text-[11px] uppercase tracking-widest text-foreground">
          {SCOPE_LABEL[scope]}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-[11px]"
          disabled={presetMut.isPending}
          onClick={() => presetMut.mutate()}
        >
          <Sparkles className="h-3 w-3" />
          {presetMut.isPending ? "Criando…" : "Usar conjunto sugerido"}
        </Button>
      </div>

      {statuses.length === 0 ? (
        <PanelEmptyState
          icon={<ListChecks className="h-4 w-4" />}
          text={`Nenhum status cadastrado para ${SCOPE_LABEL[scope].toLowerCase()}. Sem cadastro, o seletor oferece o atalho para configurar.`}
        />
      ) : (
        <div className="divide-y divide-border/60">
          {statuses.map((s, index) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="flex flex-col">
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Subir ${s.name}`}
                  disabled={index === 0 || moveMut.isPending}
                  onClick={() => moveMut.mutate({ index, dir: -1 })}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Descer ${s.name}`}
                  disabled={index === statuses.length - 1 || moveMut.isPending}
                  onClick={() => moveMut.mutate({ index, dir: 1 })}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                type="color"
                value={s.color}
                onChange={(e) => patchMut.mutate({ statusId: s.id, patch: { color: e.target.value } })}
                className="h-6 w-8 cursor-pointer rounded border border-border/60 bg-transparent"
                aria-label={`Cor de ${s.name}`}
              />
              <Input
                defaultValue={s.name}
                className="h-8 w-[220px]"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== s.name) patchMut.mutate({ statusId: s.id, patch: { name: v } });
                }}
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={s.is_done}
                  onCheckedChange={(v) =>
                    patchMut.mutate({ statusId: s.id, patch: { is_done: !!v } })
                  }
                />
                <CheckCircle2 className="h-3 w-3" /> Conta como concluído
              </label>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
                aria-label={`Excluir ${s.name}`}
                onClick={() => delMut.mutate(s.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-border/60 bg-background/40 px-4 py-3">
        <div className="grid gap-1.5">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Novo status
          </Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Em aprovação"
            className="h-8 w-[240px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) createMut.mutate();
            }}
          />
        </div>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-border/60 bg-transparent"
          aria-label="Cor do novo status"
        />
        <label className="flex items-center gap-2 pb-1.5 text-xs text-muted-foreground">
          <Checkbox checked={isDone} onCheckedChange={(v) => setIsDone(!!v)} />
          Conta como concluído
        </label>
        <Button
          size="sm"
          className="h-8 gap-1.5"
          disabled={!name.trim() || createMut.isPending}
          onClick={() => createMut.mutate()}
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar
        </Button>
      </div>
    </DashboardPanelSurface>
  );
}

function WorkStatusesPage() {
  const { brandId } = useActiveContext();
  usePageHeader(
    {
      title: "Status de trabalho",
      subtitle: "Projetos, jobs e tarefas",
    },
    [],
  );

  if (!brandId) return null;

  return (
    <DashboardPageShell>
      <p className="text-sm text-muted-foreground">
        Os status abaixo aparecem nos seletores de projeto, job e tarefa. Marcar “conta como
        concluído” ajuda os relatórios a entenderem o fim do trabalho.
      </p>
      {WORK_STATUS_SCOPES.map((scope) => (
        <ScopeSection key={scope} brandId={brandId} scope={scope} />
      ))}
    </DashboardPageShell>
  );
}
