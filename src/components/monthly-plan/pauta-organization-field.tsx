// Campo de organização da pauta: Nenhum projeto / Projeto existente / Novo projeto.
// Nunca cria projeto sem escolha explícita do usuário.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, FolderKanban, FolderPlus, Search, Slash } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listPlanProjectOptionsFn,
  type PlanOrganizationInput,
  type PlanProjectOption,
} from "@/lib/monthly-plans.functions";

export type OrganizationDraft =
  | { mode: "none" }
  | { mode: "existing"; projectId: string | null }
  | { mode: "new"; name: string; description: string; due_at: string };

export const emptyOrganization: OrganizationDraft = { mode: "none" };

/** Criação de pauta começa sem modo escolhido, já que "nenhum" não é opção. */
export const requiredOrganization: OrganizationDraft = { mode: "existing", projectId: null };

/**
 * Converte o rascunho da UI no payload do servidor; null = ainda inválido.
 * Com `allowNone = false` (criação de pauta), "nenhum projeto" é inválido.
 */
export function toOrganizationInput(
  draft: OrganizationDraft,
  allowNone = true,
): PlanOrganizationInput | null {
  if (draft.mode === "none") return allowNone ? { mode: "none" } : null;
  if (draft.mode === "existing")
    return draft.projectId ? { mode: "existing", projectId: draft.projectId } : null;
  const name = draft.name.trim();
  if (!name) return null;
  return {
    mode: "new",
    name,
    description: draft.description.trim() || null,
    due_at: draft.due_at || null,
  };
}


const MODES: Array<{
  mode: OrganizationDraft["mode"];
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  {
    mode: "none",
    label: "Nenhum projeto",
    hint: "A pauta fica válida e pode ser organizada depois",
    icon: <Slash className="h-3.5 w-3.5" />,
  },
  {
    mode: "existing",
    label: "Projeto existente",
    hint: "Vincular a uma iniciativa já em andamento",
    icon: <FolderKanban className="h-3.5 w-3.5" />,
  },
  {
    mode: "new",
    label: "Criar novo projeto",
    hint: "Criar a iniciativa aqui, sem sair da tela",
    icon: <FolderPlus className="h-3.5 w-3.5" />,
  },
];

export function PautaOrganizationField({
  brandId,
  clientId,
  value,
  onChange,
  allowNone = true,
}: {
  brandId: string;
  clientId: string;
  value: OrganizationDraft;
  onChange: (next: OrganizationDraft) => void;
  /** Na criação de pauta o projeto é obrigatório: "Nenhum projeto" não aparece. */
  allowNone?: boolean;
}) {
  const listProjects = useServerFn(listPlanProjectOptionsFn);
  const projectsQ = useQuery({
    queryKey: ["plan-project-options", brandId, clientId],
    queryFn: () => listProjects({ data: { brandId, clientId } }),
    enabled: value.mode === "existing",
    staleTime: 30_000,
  });
  const [search, setSearch] = React.useState("");
  const projects: PlanProjectOption[] = React.useMemo(() => projectsQ.data ?? [], [projectsQ.data]);
  const filtered = React.useMemo(() => {
    const t = search.trim().toLowerCase();
    return t ? projects.filter((p) => p.name.toLowerCase().includes(t)) : projects;
  }, [projects, search]);
  const modes = React.useMemo(
    () => (allowNone ? MODES : MODES.filter((m) => m.mode !== "none")),
    [allowNone],
  );

  const setMode = (mode: OrganizationDraft["mode"]) => {
    if (mode === value.mode) return;
    if (mode === "none") onChange({ mode: "none" });
    else if (mode === "existing") onChange({ mode: "existing", projectId: null });
    else onChange({ mode: "new", name: "", description: "", due_at: "" });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Projeto {allowNone ? null : <span className="text-primary">*</span>}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {allowNone
            ? "Projeto é a iniciativa que agrupa o trabalho. A pauta é a unidade editorial."
            : "Toda pauta pertence a um projeto: vincule a um existente ou crie um novo agora."}
        </p>
      </div>

      <div className={cn("grid gap-2", allowNone ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
        {modes.map((m) => {

          const active = value.mode === m.mode;
          return (
            <button
              key={m.mode}
              type="button"
              onClick={() => setMode(m.mode)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-primary/60 bg-primary/[0.07]"
                  : "border-border/60 hover:border-border hover:bg-muted/50",
              )}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                {m.icon}
                {m.label}
                {active && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                {m.hint}
              </span>
            </button>
          );
        })}
      </div>

      {value.mode === "existing" && (
        <div className="rounded-lg border border-border/60">
          <div className="flex items-center gap-2 border-b border-border/50 px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar projeto ativo deste cliente"
              className="h-7 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1.5">
            {projectsQ.isLoading ? (
              <div className="space-y-1.5 p-1">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : projectsQ.isError ? (
              <p className="px-2 py-4 text-center text-xs text-destructive">
                Não foi possível carregar os projetos.
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                {projects.length === 0
                  ? "Este cliente ainda não tem projetos ativos. Use “Criar novo projeto”."
                  : "Nenhum projeto corresponde à busca."}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((p) => {
                  const selected = value.projectId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => onChange({ mode: "existing", projectId: p.id })}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
                          selected ? "bg-primary/10 text-foreground" : "hover:bg-muted/60",
                        )}
                      >
                        <FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        {selected && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {value.mode === "new" && (
        <div className="space-y-2.5 rounded-lg border border-border/60 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-project-name" className="text-xs">
              Nome do projeto
            </Label>
            <Input
              id="new-project-name"
              value={value.name}
              onChange={(e) => onChange({ ...value, name: e.target.value })}
              placeholder="Ex.: POSTS SETEMBRO"
              maxLength={120}
            />
          </div>
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_170px]">
            <div className="space-y-1.5">
              <Label htmlFor="new-project-desc" className="text-xs">
                Descrição <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Textarea
                id="new-project-desc"
                value={value.description}
                onChange={(e) => onChange({ ...value, description: e.target.value })}
                rows={2}
                placeholder="O que essa iniciativa cobre"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-project-due" className="text-xs">
                Prazo <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="new-project-due"
                type="date"
                value={value.due_at}
                onChange={(e) => onChange({ ...value, due_at: e.target.value })}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
