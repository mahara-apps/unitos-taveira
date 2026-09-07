/**
 * Comunicador interno (Mensagens) — camada PURA.
 *
 * Tipos compartilhados entre servidor e UI, mais agrupamento, prévia, contagem
 * de não lidas e ordenação. Nenhuma decisão de acesso vive aqui: escopo e
 * permissão são resolvidos no banco (RLS + `can_access_message_thread`) e nas
 * server functions.
 */

export type ThreadScope = "client" | "team_dm" | "project";
export type ThreadVisibility = "internal" | "shared_with_client";
export type ThreadParticipantRole = "team" | "portal_client";

export type MessageLink = { url: string; title: string | null; source: string };

export type ThreadParticipant = {
  userId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  roleInThread: ThreadParticipantRole;
  lastReadAt: string | null;
};

export type ThreadSummary = {
  id: string;
  scope: ThreadScope;
  subject: string;
  visibility: ThreadVisibility;
  clientId: string | null;
  clientName: string | null;
  projectId: string | null;
  projectName: string | null;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastAuthorName: string | null;
  unread: number;
  participants: ThreadParticipant[];
};

export type MessageItem = {
  id: string;
  threadId: string;
  authorId: string;
  authorName: string;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  authorKind: ThreadParticipantRole;
  body: string;
  links: MessageLink[];
  mentions: string[];
  removedAt: string | null;
  createdAt: string;
};

export const MAX_MESSAGE_LINKS = 10;
export const MAX_MESSAGE_LENGTH = 8000;
export const THREAD_PREVIEW_LENGTH = 280;

export const SCOPE_LABEL: Record<ThreadScope, string> = {
  client: "Cliente",
  team_dm: "Conversa direta",
  project: "Projeto",
};

export const VISIBILITY_LABEL: Record<ThreadVisibility, string> = {
  internal: "Interna",
  shared_with_client: "Compartilhada com o cliente",
};

const isThreadScope = (v: unknown): v is ThreadScope =>
  v === "client" || v === "team_dm" || v === "project";

export const normalizeThreadScope = (v: unknown): ThreadScope =>
  isThreadScope(v) ? v : "team_dm";

export const normalizeVisibility = (v: unknown): ThreadVisibility =>
  v === "shared_with_client" ? "shared_with_client" : "internal";

/** Conversa compartilhada é a única que o contato do cliente pode alcançar. */
export const isSharedWithClient = (t: Pick<ThreadSummary, "scope" | "visibility">): boolean =>
  t.scope === "client" && t.visibility === "shared_with_client";

/** Prévia curta e sem quebras de linha, para listas. */
export function previewOf(body: string | null | undefined): string {
  const flat = (body ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  return flat.length > THREAD_PREVIEW_LENGTH
    ? `${flat.slice(0, THREAD_PREVIEW_LENGTH - 1)}…`
    : flat;
}

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

/** Mais recente primeiro; empate resolvido pelo assunto para ordem estável. */
export function sortThreads<T extends Pick<ThreadSummary, "lastMessageAt" | "subject">>(
  threads: T[],
): T[] {
  return [...threads].sort((a, b) => {
    const diff = time(b.lastMessageAt) - time(a.lastMessageAt);
    return diff !== 0 ? diff : a.subject.localeCompare(b.subject, "pt-BR");
  });
}

/** Não lidas de uma conversa a partir da última leitura do usuário. */
export function unreadFrom(
  lastReadAt: string | null | undefined,
  messageTimes: Array<string | null | undefined>,
  authorIds: Array<string | null | undefined>,
  currentUserId: string,
): number {
  const since = time(lastReadAt);
  let count = 0;
  for (let i = 0; i < messageTimes.length; i += 1) {
    if (authorIds[i] === currentUserId) continue;
    if (time(messageTimes[i]) > since) count += 1;
  }
  return count;
}

export function totalUnread(threads: Array<Pick<ThreadSummary, "unread">>): number {
  return threads.reduce((sum, t) => sum + Math.max(0, t.unread), 0);
}

export type ClientThreadGroup = {
  clientId: string;
  clientName: string;
  threads: ThreadSummary[];
  unread: number;
  lastMessageAt: string;
};

/**
 * Conversas de cliente agrupadas por cliente, cada grupo já ordenado.
 * Conversas sem cliente (direta/projeto) são ignoradas de propósito.
 */
export function groupThreadsByClient(threads: ThreadSummary[]): ClientThreadGroup[] {
  const groups = new Map<string, ClientThreadGroup>();
  for (const t of threads) {
    if (!t.clientId) continue;
    const current = groups.get(t.clientId) ?? {
      clientId: t.clientId,
      clientName: t.clientName ?? "Cliente",
      threads: [],
      unread: 0,
      lastMessageAt: t.lastMessageAt,
    };
    current.threads.push(t);
    current.unread += Math.max(0, t.unread);
    if (time(t.lastMessageAt) > time(current.lastMessageAt)) {
      current.lastMessageAt = t.lastMessageAt;
    }
    groups.set(t.clientId, current);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, threads: sortThreads(g.threads) }))
    .sort((a, b) => time(b.lastMessageAt) - time(a.lastMessageAt));
}

/** Busca livre por assunto, cliente, projeto ou participante. */
export function filterThreads(threads: ThreadSummary[], term: string): ThreadSummary[] {
  const q = term.trim().toLocaleLowerCase("pt-BR");
  if (!q) return threads;
  return threads.filter((t) =>
    [
      t.subject,
      t.clientName ?? "",
      t.projectName ?? "",
      t.lastMessagePreview ?? "",
      ...t.participants.map((p) => `${p.name} ${p.email ?? ""}`),
    ]
      .join(" ")
      .toLocaleLowerCase("pt-BR")
      .includes(q),
  );
}

/** Título da conversa direta: os outros participantes, nunca o próprio usuário. */
export function dmTitle(t: ThreadSummary, currentUserId: string): string {
  const others = t.participants.filter((p) => p.userId !== currentUserId);
  if (!others.length) return t.subject || "Conversa direta";
  return others.map((p) => p.name).join(", ");
}

/** Rótulo de contexto exibido abaixo do assunto. */
export function threadContextLabel(t: ThreadSummary): string {
  if (t.scope === "client") return t.clientName ?? "Cliente";
  if (t.scope === "project") return t.projectName ?? "Projeto";
  return SCOPE_LABEL.team_dm;
}
