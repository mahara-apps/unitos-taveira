/**
 * Fio de comentários/observações reutilizado nos três níveis da hierarquia:
 * projeto, job e tarefa. Projeto/job usam `work_comments`; tarefa reaproveita
 * `task_comments` (que já existia).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MentionTextarea, resolveMentions } from "@/components/ui/mention-textarea";
import { MentionText } from "@/components/ui/mention-text";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addWorkCommentFn,
  deleteWorkCommentFn,
  listWorkCommentsFn,
} from "@/lib/work-comments.functions";
import { addTaskCommentFn, deleteTaskCommentFn, listTaskCommentsFn } from "@/lib/tasks.functions";
import { listBrandAssigneesFn } from "@/lib/content.functions";
import { APP_TIMEZONE } from "@/lib/timezone";
import { displayName, initialsOf } from "@/lib/identity";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Entry = {
  id: string;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
  body: string;
  created_at: string;
};

type Props = {
  brandId: string;
  /** Nível do fio. `task` usa task_comments; os outros usam work_comments. */
  level: "project" | "job" | "task";
  projectId?: string;
  jobId?: string | null;
  taskId?: string;
  currentUserId?: string | null;
  className?: string;
  placeholder?: string;
};

function initials(name: string | null) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function CommentThread({
  brandId,
  level,
  projectId,
  jobId = null,
  taskId,
  currentUserId,
  className,
  placeholder = "Escreva uma observação… use @ para mencionar",
}: Props) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const listWork = useServerFn(listWorkCommentsFn);
  const addWork = useServerFn(addWorkCommentFn);
  const delWork = useServerFn(deleteWorkCommentFn);
  const listAssignees = useServerFn(listBrandAssigneesFn);
  const listTask = useServerFn(listTaskCommentsFn);
  const addTask = useServerFn(addTaskCommentFn);
  const delTask = useServerFn(deleteTaskCommentFn);

  const isTask = level === "task";
  const queryKey = isTask
    ? (["task-comments", taskId] as const)
    : (["work-comments", brandId, projectId, jobId] as const);

  const listQ = useQuery({
    queryKey,
    enabled: isTask ? !!taskId : !!projectId && !!brandId,
    queryFn: async (): Promise<Entry[]> => {
      if (isTask) return (await listTask({ data: { taskId: taskId! } })) as Entry[];
      return (await listWork({
        data: { brandId, projectId: projectId!, jobId: jobId ?? null },
      })) as Entry[];
    },
  });

  const peopleQ = useQuery({
    queryKey: ["brand-assignees", brandId],
    queryFn: () => listAssignees({ data: { brandId } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });
  const people = peopleQ.data ?? [];
  /** Identidade do autor: usa o perfil da equipe quando disponível. */
  const authorOf = (c: Entry) => {
    const p = people.find((x) => x.id === c.author_id);
    return { full_name: c.author_name ?? p?.name ?? null, email: p?.email ?? null };
  };

  const addMut = useMutation({
    mutationFn: async (text: string) => {
      const mentions = resolveMentions(text, people);
      if (isTask) return addTask({ data: { taskId: taskId!, body: text, mentions } });
      return addWork({
        data: { brandId, projectId: projectId!, jobId: jobId ?? null, body: text, mentions },
      });
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) =>
      isTask ? delTask({ data: { commentId: id } }) : delWork({ data: { commentId: id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const entries = listQ.data ?? [];

  return (
    <div className={className}>
      <div className="flex items-center gap-2 border-b border-border/60 bg-background/40 px-4 py-2.5">
        <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-foreground">
          Comentários
        </h3>
        {entries.length > 0 ? (
          <span className="rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-xs tabular-nums text-foreground">
            {entries.length}
          </span>
        ) : null}
      </div>

      <div className="max-h-[360px] space-y-3 overflow-y-auto px-4 py-3">
        {listQ.isPending ? (
          <>
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </>
        ) : entries.length === 0 ? (
          <PanelEmptyState
            icon={<MessageSquare className="h-4 w-4" />}
            text="Nenhuma observação registrada aqui ainda."
          />
        ) : (
          entries.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar className="h-7 w-7 shrink-0">
                {c.author_avatar ? <AvatarImage src={c.author_avatar} alt="" /> : null}
                <AvatarFallback className="text-[10px]">{initialsOf(authorOf(c))}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium">{displayName(authorOf(c), "Usuário")}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatWhen(c.created_at)}
                  </span>
                  {currentUserId && c.author_id === currentUserId ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-6 w-6 text-muted-foreground"
                      onClick={() => delMut.mutate(c.id)}
                      aria-label="Excluir comentário"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  ) : null}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground/90">
                  <MentionText text={c.body} people={people} />
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border/60 p-3">
        <MentionTextarea
          value={body}
          onChange={setBody}
          people={people}
          placeholder={placeholder}
          rows={2}
          onSubmit={() => {
            if (body.trim()) addMut.mutate(body.trim());
          }}
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            className="h-8 gap-1.5"
            disabled={!body.trim() || addMut.isPending}
            onClick={() => addMut.mutate(body.trim())}
          >
            <Send className="h-3.5 w-3.5" />
            Comentar
          </Button>
        </div>
      </div>
    </div>
  );
}
