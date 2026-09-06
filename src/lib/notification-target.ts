/**
 * Destino de uma notificação — fonte única de verdade.
 *
 * Regra: clicar em um aviso abre a TELA do item e, quando possível, o próprio
 * item (post, tarefa, pauta, briefing, pedido do cliente, agenda).
 *
 * A resolução usa primeiro o `payload` gravado pelo produtor (mais confiável e
 * já presente nos avisos antigos) e só depois o `href` salvo, reescrevendo
 * endereços legados (`/content` sem post, `?post=` na ficha do cliente,
 * `?task=` em tarefas, `/content/plans/:id`, `/customers/:id/pauta`).
 *
 * Nunca retorna `null`: um aviso sem item específico abre a tela mais próxima
 * do assunto, então o clique nunca é "morto".
 */
import { resolveCustomerTab, type CustomerTab } from "@/lib/customer-tabs";

export type NotificationTargetLike = {
  kind?: string | null;
  href?: string | null;
  payload?: unknown;
};

export type NotificationTarget = {
  /** Rota do TanStack Router (com `$customerId` quando houver params). */
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string | number | boolean>;
  /** Cliente ao qual o item pertence — usado para trocar o contexto ativo. */
  clientId?: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function record(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

const postTarget = (postId: string, clientId?: string): NotificationTarget => ({
  to: "/content",
  search: { post: postId },
  ...(clientId ? { clientId } : {}),
});

const threadTarget = (threadId: string, clientId?: string): NotificationTarget => ({
  to: "/messages/$threadId",
  params: { threadId },
  ...(clientId ? { clientId } : {}),
});

const taskTarget = (taskId: string): NotificationTarget => ({
  to: "/tasks",
  search: { taskId },
});

const customerTarget = (
  clientId: string,
  tab: CustomerTab,
  extra?: Record<string, string>,
): NotificationTarget => ({
  to: "/customers/$customerId",
  params: { customerId: clientId },
  search: { tab, ...(extra ?? {}) },
  clientId,
});

/** Fallback por assunto quando não há item identificável. */
function fallbackForKind(kind: string | null | undefined): NotificationTarget {
  switch (kind) {
    case "mention":
    case "assignment":
      return { to: "/tasks" };
    case "approval_requested":
    case "approval_decision":
    case "sla_overdue":
    case "sla_overdue_manager":
      return { to: "/content" };
    case "deadline":
      return { to: "/calendar" };
    case "message":
      return { to: "/messages" };
    default:
      return { to: "/notifications" };
  }
}

/** Reescreve um href legado (texto puro) em rota + parâmetros de busca. */
function fromHref(href: string): NotificationTarget | null {
  const [rawPath, rawQuery = ""] = href.split("?");
  const path = (rawPath ?? "").replace(/\/+$/, "") || "/";
  const query = new URLSearchParams(rawQuery);
  const get = (k: string) => query.get(k) ?? undefined;

  // /customers/<uuid>[/aba][?post=&planId=&tab=]
  const customer = /^\/customers\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/i.exec(path);
  if (customer) {
    const clientId = customer[1] as string;
    const post = get("post");
    // Post nunca abriu na ficha do cliente: o lugar do post é a tela Conteúdo.
    if (isUuid(post)) return postTarget(post, clientId);
    const tab = resolveCustomerTab(customer[2] ?? get("tab"));
    const planId = get("planId");
    return customerTarget(clientId, tab, isUuid(planId) ? { planId } : undefined);
  }

  if (path === "/content" || path.startsWith("/content/plans")) {
    const post = get("post");
    if (isUuid(post)) return postTarget(post);
    const project = get("project");
    return { to: "/content", ...(isUuid(project) ? { search: { project } } : {}) };
  }

  // /messages/<uuid> — conversa do comunicador interno.
  const thread = /^\/messages\/([0-9a-f-]{36})$/i.exec(path);
  if (thread) return threadTarget(thread[1] as string);
  if (path === "/messages") return { to: "/messages" };

  if (path === "/tasks") {
    const taskId = get("taskId") ?? get("task");
    return isUuid(taskId) ? taskTarget(taskId) : { to: "/tasks" };
  }

  if (path === "/inbox") {
    const cliente = get("cliente");
    return {
      to: "/inbox",
      ...(isUuid(cliente) ? { search: { cliente }, clientId: cliente } : {}),
    };
  }

  if (path === "/calendar" || path === "/customers" || path === "/connections") {
    return { to: path };
  }

  // Rotas do portal e demais telas internas conhecidas: navegação direta.
  if (path.startsWith("/area/") || path.startsWith("/settings") || path.startsWith("/admin")) {
    const cliente = get("cliente");
    return {
      to: path,
      ...(isUuid(cliente) ? { search: { cliente }, clientId: cliente } : {}),
    };
  }

  return null;
}

export function resolveNotificationTarget(n: NotificationTargetLike): NotificationTarget {
  const p = record(n.payload);
  const kind = n.kind ?? null;
  const clientId = isUuid(p["client_id"]) ? (p["client_id"] as string) : undefined;
  const source = typeof p["source"] === "string" ? (p["source"] as string) : null;
  const entityId = isUuid(p["entity_id"]) ? (p["entity_id"] as string) : undefined;

  // 1) Item explícito no payload.
  const postId = isUuid(p["post_id"])
    ? (p["post_id"] as string)
    : source === "post" && entityId
      ? entityId
      : undefined;
  if (postId) return postTarget(postId, clientId);

  const taskId = isUuid(p["task_id"])
    ? (p["task_id"] as string)
    : source === "task" && entityId
      ? entityId
      : undefined;
  if (taskId) return taskTarget(taskId);

  const threadId = isUuid(p["thread_id"])
    ? (p["thread_id"] as string)
    : source === "message" && entityId
      ? entityId
      : undefined;
  if (threadId) return threadTarget(threadId, clientId);

  if (isUuid(p["monthly_plan_id"]) && clientId) {
    return customerTarget(clientId, "pauta", { planId: p["monthly_plan_id"] as string });
  }

  if (isUuid(p["request_id"]) && clientId) {
    return { to: "/inbox", search: { cliente: clientId }, clientId };
  }

  // 2) Resumo agregado (SLA do gestor): abre o primeiro post da lista.
  const postIds = Array.isArray(p["post_ids"]) ? (p["post_ids"] as unknown[]) : [];
  const firstPost = postIds.find(isUuid);
  if (firstPost) return postTarget(firstPost as string, clientId);

  // 3) Href salvo (normalizado).
  const href = typeof n.href === "string" && n.href.startsWith("/") ? n.href : null;
  const fromLink = href ? fromHref(href) : null;
  if (fromLink) return { ...fromLink, ...(fromLink.clientId ? {} : clientId ? { clientId } : {}) };

  // 4) Só o cliente é conhecido.
  if (clientId) return customerTarget(clientId, "overview");

  return fallbackForKind(kind);
}

/** Variante do portal do cliente: só permite rotas `/area/*`. */
export function resolvePortalNotificationTarget(
  n: NotificationTargetLike,
  clientId: string | null,
): NotificationTarget | null {
  const href = typeof n.href === "string" ? n.href : "";
  const path = href.split("?")[0] ?? "";
  if (!path.startsWith("/area/")) return null;
  const cliente = new URLSearchParams(href.split("?")[1] ?? "").get("cliente") ?? clientId;
  return { to: path, ...(isUuid(cliente) ? { search: { cliente } } : {}) };
}
