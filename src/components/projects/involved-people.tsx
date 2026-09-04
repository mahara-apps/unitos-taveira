/**
 * Pessoas envolvidas — sempre no nível do PROJETO. Jobs e tarefas herdam
 * essa lista (não há envolvidos próprios por job/tarefa).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Plus, UserMinus, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  addProjectParticipantFn,
  listProjectParticipantsFn,
  removeProjectParticipantFn,
} from "@/lib/project-participants.functions";
import { initialsOf, type TeamOption } from "@/components/projects/assignee-picker";
import { AvatarStack } from "@/components/projects/avatar-stack";

export function useProjectParticipants(brandId: string, projectId: string) {
  const list = useServerFn(listProjectParticipantsFn);
  return useQuery({
    queryKey: ["project-participants", brandId, projectId],
    enabled: !!brandId && !!projectId,
    queryFn: () => list({ data: { brandId, projectId } }),
  });
}

export function InvolvedPeople({
  brandId,
  projectId,
  team,
  canEdit,
  compact = false,
}: {
  brandId: string;
  projectId: string;
  team: TeamOption[];
  canEdit: boolean;
  /** Variante do rodapé: avatares sobrepostos em vez de chips. */
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const participantsQ = useProjectParticipants(brandId, projectId);
  const add = useServerFn(addProjectParticipantFn);
  const remove = useServerFn(removeProjectParticipantFn);
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["project-participants", brandId, projectId] });

  const addMut = useMutation({
    mutationFn: (userId: string) => add({ data: { brandId, projectId, userId } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const removeMut = useMutation({
    mutationFn: (userId: string) => remove({ data: { brandId, projectId, userId } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const participants = participantsQ.data ?? [];
  const available = team.filter((t) => !participants.some((p) => p.user_id === t.user_id));

  const addMenu =
    canEdit && available.length > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-full"
            aria-label="Envolver pessoa"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          {available.map((t) => (
            <DropdownMenuItem key={t.user_id} onClick={() => addMut.mutate(t.user_id)}>
              <span className="flex items-center gap-2">
                <Avatar className="h-5 w-5">
                  {t.avatar_url ? <AvatarImage src={t.avatar_url} alt="" /> : null}
                  <AvatarFallback className="text-[9px]">{initialsOf(t.full_name)}</AvatarFallback>
                </Avatar>
                {t.full_name ?? "Usuário"}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 font-mono text-[10px] uppercase leading-tight tracking-widest text-muted-foreground">
          Envolvidos
          <br />
          no projeto
        </span>
        <AvatarStack people={participants} />
        {addMenu}
        {canEdit && participants.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                Gerenciar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {participants.map((p) => (
                <DropdownMenuItem key={p.user_id} onClick={() => removeMut.mutate(p.user_id)}>
                  <UserMinus className="mr-2 h-3.5 w-3.5" />
                  Remover {p.full_name ?? "usuário"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Users className="h-3 w-3" />
        Envolvidos
      </span>
      {participants.length === 0 ? (
        <span className="text-xs text-muted-foreground">Ninguém adicionado</span>
      ) : null}
      {participants.map((p) => (
        <span
          key={p.user_id}
          className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 py-0.5 pl-0.5 pr-2 text-xs"
        >
          <Avatar className="h-5 w-5">
            {p.avatar_url ? <AvatarImage src={p.avatar_url} alt="" /> : null}
            <AvatarFallback className="text-[9px]">{initialsOf(p.full_name)}</AvatarFallback>
          </Avatar>
          <span className="max-w-[140px] truncate">{p.full_name ?? "Usuário"}</span>
          {canEdit ? (
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-destructive"
              aria-label={`Remover ${p.full_name ?? "usuário"} dos envolvidos`}
              onClick={() => removeMut.mutate(p.user_id)}
            >
              <UserMinus className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
      {canEdit && available.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
              <Plus className="h-3 w-3" />
              Envolver
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            {available.map((t) => (
              <DropdownMenuItem key={t.user_id} onClick={() => addMut.mutate(t.user_id)}>
                <span className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    {t.avatar_url ? <AvatarImage src={t.avatar_url} alt="" /> : null}
                    <AvatarFallback className="text-[9px]">
                      {initialsOf(t.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  {t.full_name ?? "Usuário"}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
