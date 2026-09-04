import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus, Search, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  createChatConversationFn,
  deleteChatConversationFn,
  listChatConversationsFn,
  renameChatConversationFn,
  type ChatConversationRow,
} from "@/lib/chat.functions";
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
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useActiveContext } from "@/hooks/use-active-context";

export function ChatShell({ children }: { children: ReactNode }) {
  const list = useServerFn(listChatConversationsFn);
  const create = useServerFn(createChatConversationFn);
  const rename = useServerFn(renameChatConversationFn);
  const remove = useServerFn(deleteChatConversationFn);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { conversationId?: string };
  const activeId = params.conversationId;
  const { brandId, clientId } = useActiveContext();

  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const conversations = useQuery({
    queryKey: ["chat", "conversations", brandId ?? "all", clientId ?? "all"],
    queryFn: () => list(),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    let rows = conversations.data ?? [];
    // Escopa pela conta ativa: cliente selecionado -> só conversas dele.
    // Modo agência (sem cliente) -> só conversas não vinculadas a cliente.
    rows = clientId
      ? rows.filter((r) => r.client_id === clientId)
      : rows.filter((r) => !r.client_id);
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.title.toLowerCase().includes(q));
  }, [conversations.data, query, clientId]);

  const newChat = useMutation({
    mutationFn: () => create({ data: { brandId: brandId ?? null, clientId: clientId ?? null } }),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      navigate({ to: "/chat/$conversationId", params: { conversationId: row.id } });
    },
  });

  const renameM = useMutation({
    mutationFn: (v: { id: string; title: string }) => rename({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      setEditingId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao renomear"),
  });

  const removeM = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      if (activeId === id) navigate({ to: "/chat" });
      setConfirmDeleteId(null);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao excluir"),
  });

  return (
    <div className="grid h-[calc(100vh-var(--app-header-h,4rem))] grid-cols-[280px_1fr] overflow-hidden">
      <aside className="flex flex-col border-r bg-muted/30">
        <div className="p-3 space-y-2 border-b">
          <Button
            onClick={() => newChat.mutate()}
            disabled={newChat.isPending}
            className="w-full justify-start gap-2"
            variant="default"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Nova conversa
          </Button>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
        <ScrollArea className="flex-1">
          <ul className="p-2 space-y-0.5">
            {conversations.isLoading && (
              <li className="text-xs text-muted-foreground px-2 py-4">Carregando…</li>
            )}
            {!conversations.isLoading && filtered.length === 0 && (
              <li className="text-xs text-muted-foreground px-2 py-4">
                {query ? "Nada encontrado" : "Nenhuma conversa ainda"}
              </li>
            )}
            {filtered.map((c) => (
              <ConversationItem
                key={c.id}
                row={c}
                active={c.id === activeId}
                editing={editingId === c.id}
                editingTitle={editingTitle}
                onStartEdit={() => {
                  setEditingId(c.id);
                  setEditingTitle(c.title);
                }}
                onCancelEdit={() => setEditingId(null)}
                onChangeTitle={setEditingTitle}
                onSaveTitle={() => {
                  const t = editingTitle.trim();
                  if (!t || t === c.title) {
                    setEditingId(null);
                    return;
                  }
                  renameM.mutate({ id: c.id, title: t });
                }}
                onDelete={() => setConfirmDeleteId(c.id)}
              />
            ))}
          </ul>
        </ScrollArea>
      </aside>
      <main className="min-w-0 overflow-hidden">{children}</main>

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conversa?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as mensagens e anexos serão removidos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDeleteId && removeM.mutate(confirmDeleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConversationItem(props: {
  row: ChatConversationRow;
  active: boolean;
  editing: boolean;
  editingTitle: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeTitle: (v: string) => void;
  onSaveTitle: () => void;
  onDelete: () => void;
}) {
  const { row, active, editing } = props;
  return (
    <li className="group relative">
      {editing ? (
        <div className="px-2 py-1.5">
          <Input
            autoFocus
            value={props.editingTitle}
            onChange={(e) => props.onChangeTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onSaveTitle();
              if (e.key === "Escape") props.onCancelEdit();
            }}
            onBlur={props.onSaveTitle}
            className="h-7 text-xs"
          />
        </div>
      ) : (
        <Link
          to="/chat/$conversationId"
          params={{ conversationId: row.id }}
          className={cn(
            "flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent/80 transition-colors",
            active && "bg-accent text-accent-foreground",
          )}
        >
          <span className="truncate font-medium leading-tight">{row.title}</span>
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(row.last_message_at), { addSuffix: true, locale: ptBR })}
          </span>
        </Link>
      )}
      {!editing && (
        <div className="absolute right-1 top-1 hidden gap-0.5 group-hover:flex">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onStartEdit();
            }}
            className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label="Renomear"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onDelete();
            }}
            className="rounded p-1 text-muted-foreground hover:bg-background hover:text-destructive"
            aria-label="Excluir"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </li>
  );
}
