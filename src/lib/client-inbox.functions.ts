import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notifyPortalContacts } from "@/lib/client-comms.server";

/**
 * Caixa de entrada do cliente (lado da equipe).
 *
 * Agrega, num único fluxo, tudo que chega da Área do Cliente: pedidos,
 * comentários dos conteúdos, decisões de aprovação (aprovou / pediu ajuste /
 * rejeitou) e briefings enviados.
 *
 * Escopo: todas as leituras usam `context.supabase` (RLS como o próprio
 * usuário). `can_access_client` já garante que owner/admin veem o workspace e
 * manager/user apenas os clientes atribuídos — nada de admin client aqui.
 */

type AnyClient = { from: (table: string) => any };

export const CLIENT_INBOX_TYPES = ["request", "comment", "decision", "briefing"] as const;
export type ClientInboxType = (typeof CLIENT_INBOX_TYPES)[number];

export type ClientInboxItem = {
  id: string;
  type: ClientInboxType;
  clientId: string;
  clientName: string | null;
  title: string;
  body: string | null;
  authorName: string | null;
  createdAt: string;
  /** Situação atual (pedidos) ou decisão (aprovações). */
  status: string | null;
  /** Sem resposta da equipe. */
  awaiting: boolean;
  /** Alvo da resposta. */
  requestId: string | null;
  postId: string | null;
  href: string;
};

const ListIn = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid().nullish(),
  type: z.enum(CLIENT_INBOX_TYPES).nullish(),
  awaitingOnly: z.boolean().optional(),
  limit: z.number().int().min(10).max(300).optional(),
});

function customerHref(clientId: string, tab: string) {
  return `/customers/${clientId}?tab=${tab}`;
}

export const listClientInboxFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListIn.parse(i))
  .handler(async ({ data, context }): Promise<ClientInboxItem[]> => {
    const sb = context.supabase as AnyClient;
    const limit = data.limit ?? 120;
    const wants = (t: ClientInboxType) => !data.type || data.type === t;

    const scoped = <T,>(q: T): T => {
      const query = q as any;
      return (data.clientId ? query.eq("client_id", data.clientId) : query) as T;
    };

    const [clientsRes, requestsRes, commentsRes, decisionsRes, briefingsRes] = await Promise.all([
      sb.from("clients").select("id, name").eq("brand_id", data.brandId),
      wants("request")
        ? scoped(
            sb
              .from("client_requests")
              .select(
                "id, client_id, title, description, status, created_at, updated_at, created_by_name, last_team_reply_at",
              )
              .eq("brand_id", data.brandId)
              .order("created_at", { ascending: false })
              .limit(limit),
          )
        : Promise.resolve({ data: [] }),
      wants("comment")
        ? scoped(
            sb
              .from("post_client_comments")
              .select("id, client_id, post_id, body, author_name, author_side, created_at")
              .eq("brand_id", data.brandId)
              .order("created_at", { ascending: false })
              .limit(limit * 2),
          )
        : Promise.resolve({ data: [] }),
      wants("decision")
        ? scoped(
            sb
              .from("activity_events")
              .select("id, client_id, entity_id, verb, payload, created_at")
              .eq("brand_id", data.brandId)
              .eq("entity_type", "post")
              .in("verb", ["portal_approved", "portal_rejected", "portal_adjust", "portal_comment"])
              .order("created_at", { ascending: false })
              .limit(limit),
          )
        : Promise.resolve({ data: [] }),
      wants("briefing")
        ? scoped(
            sb
              .from("brand_briefing_requests")
              .select("id, client_id, title, status, submitted_at, updated_at")
              .eq("brand_id", data.brandId)
              .eq("status", "submitted")
              .order("updated_at", { ascending: false })
              .limit(limit),
          )
        : Promise.resolve({ data: [] }),
    ]);

    const names = new Map<string, string | null>();
    for (const c of ((clientsRes as { data?: unknown }).data ?? []) as Array<{
      id: string;
      name: string | null;
    }>) {
      names.set(c.id, c.name);
    }
    const nameOf = (id: string) => names.get(id) ?? null;

    const rows = <T,>(res: unknown): T[] => (((res as { data?: unknown }).data ?? []) as T[]);
    const items: ClientInboxItem[] = [];

    for (const r of rows<Record<string, any>>(requestsRes)) {
      items.push({
        id: `request:${r["id"]}`,
        type: "request",
        clientId: r["client_id"],
        clientName: nameOf(r["client_id"]),
        title: r["title"] ?? "Pedido do cliente",
        body: r["description"] ?? null,
        authorName: r["created_by_name"] ?? null,
        createdAt: r["created_at"],
        status: r["status"] ?? null,
        awaiting:
          !r["last_team_reply_at"] &&
          !["done", "rejected", "cancelled"].includes(String(r["status"] ?? "")),
        requestId: r["id"],
        postId: null,
        href: customerHref(r["client_id"], "conta"),
      });
    }

    // Comentários: só os do cliente entram na caixa; a última mensagem da equipe
    // no mesmo conteúdo é o que zera a pendência.
    const comments = rows<Record<string, any>>(commentsRes);
    const lastTeamByPost = new Map<string, string>();
    for (const c of comments) {
      if (c["author_side"] === "team") {
        const prev = lastTeamByPost.get(c["post_id"]);
        if (!prev || prev < c["created_at"]) lastTeamByPost.set(c["post_id"], c["created_at"]);
      }
    }
    for (const c of comments) {
      if (c["author_side"] === "team") continue;
      const lastTeam = lastTeamByPost.get(c["post_id"]);
      items.push({
        id: `comment:${c["id"]}`,
        type: "comment",
        clientId: c["client_id"],
        clientName: nameOf(c["client_id"]),
        title: "Comentário do cliente",
        body: c["body"] ?? null,
        authorName: c["author_name"] ?? null,
        createdAt: c["created_at"],
        status: null,
        awaiting: !lastTeam || lastTeam < c["created_at"],
        requestId: null,
        postId: c["post_id"],
        href: customerHref(c["client_id"], "publicacoes"),
      });
    }

    for (const e of rows<Record<string, any>>(decisionsRes)) {
      const verb = String(e["verb"] ?? "").replace("portal_", "");
      if (verb === "comment") continue; // já coberto pelos comentários
      const payload = (e["payload"] ?? {}) as Record<string, unknown>;
      const clientId = e["client_id"] as string;
      const lastTeam = lastTeamByPost.get(e["entity_id"]);
      items.push({
        id: `decision:${e["id"]}`,
        type: "decision",
        clientId,
        clientName: nameOf(clientId),
        title:
          verb === "approved"
            ? "Cliente aprovou um conteúdo"
            : verb === "rejected"
              ? "Cliente rejeitou um conteúdo"
              : "Cliente pediu ajustes",
        body:
          [payload["title"] as string | undefined, payload["note"] as string | undefined]
            .filter(Boolean)
            .join(" — ") || null,
        authorName: (payload["by"] as string | undefined) ?? null,
        createdAt: e["created_at"],
        status: verb,
        awaiting: verb !== "approved" && (!lastTeam || lastTeam < e["created_at"]),
        requestId: null,
        postId: e["entity_id"] ?? null,
        href: customerHref(clientId, "publicacoes"),
      });
    }

    for (const b of rows<Record<string, any>>(briefingsRes)) {
      const clientId = b["client_id"] as string;
      items.push({
        id: `briefing:${b["id"]}`,
        type: "briefing",
        clientId,
        clientName: nameOf(clientId),
        title: "Briefing enviado pelo cliente",
        body: (b["title"] as string | null) ?? null,
        authorName: null,
        createdAt: (b["submitted_at"] as string | null) ?? b["updated_at"],
        status: "submitted",
        awaiting: true,
        requestId: null,
        postId: null,
        href: customerHref(clientId, "briefing"),
      });
    }

    const filtered = data.awaitingOnly ? items.filter((i) => i.awaiting) : items;
    return filtered
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  });

async function teamName(supabase: unknown, userId: string): Promise<string | null> {
  const { data } = await (supabase as AnyClient)
    .from("user_profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return ((data as { full_name?: string | null } | null)?.full_name ?? null) || null;
}

/**
 * Resposta da equipe. Um único ponto de entrada para as duas conversas:
 * pedido (`requestId`) ou conteúdo em aprovação (`postId`).
 *
 * A RLS de `client_requests` / `post_client_comments` (`can_access_client`)
 * é a autorização definitiva — quem não responde por aquele cliente falha aqui.
 */
export const replyClientInboxFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        requestId: z.string().uuid().nullish(),
        postId: z.string().uuid().nullish(),
        note: z.string().trim().min(1, "Escreva a resposta").max(4000),
        status: z
          .enum(["submitted", "info_needed", "accepted", "in_production", "done", "rejected"])
          .nullish(),
      })
      .refine((v) => Boolean(v.requestId) !== Boolean(v.postId), {
        message: "Informe o pedido OU o conteúdo",
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const sb = context.supabase as AnyClient;
    const name = await teamName(context.supabase, context.userId);
    const now = new Date().toISOString();

    if (data.requestId) {
      const { data: row, error: readErr } = await sb
        .from("client_requests")
        .select("id, title, status")
        .eq("id", data.requestId)
        .eq("client_id", data.clientId)
        .maybeSingle();
      if (readErr) throw new Error((readErr as { message: string }).message);
      if (!row) throw new Error("request_not_found");

      const { error: evErr } = await sb.from("client_request_events").insert({
        request_id: data.requestId,
        client_id: data.clientId,
        actor_id: context.userId,
        actor_name: name,
        actor_side: "team",
        kind: data.status ? "status" : "comment",
        note: data.note,
      });
      if (evErr) throw new Error((evErr as { message: string }).message);

      const patch: Record<string, unknown> = { last_team_reply_at: now };
      if (data.status) patch["status"] = data.status;
      const { error: upErr } = await sb
        .from("client_requests")
        .update(patch)
        .eq("id", data.requestId)
        .eq("client_id", data.clientId);
      if (upErr) throw new Error((upErr as { message: string }).message);

      await notifyPortalContacts({
        brandId: data.brandId,
        clientId: data.clientId,
        prefKind: "requests",
        title: data.status ? "Seu pedido foi atualizado" : "A equipe respondeu seu pedido",
        body: (row as { title: string }).title,
        href: `/area/pedidos?cliente=${data.clientId}`,
        dedupeParts: ["request_reply", data.requestId, now],
        payload: { request_id: data.requestId },
      });
      return { ok: true };
    }

    const postId = data.postId!;
    const { data: post } = await sb
      .from("posts")
      .select("id, title")
      .eq("id", postId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!post) throw new Error("post_not_found");

    const { error } = await sb.from("post_client_comments").insert({
      brand_id: data.brandId,
      client_id: data.clientId,
      post_id: postId,
      author_user_id: context.userId,
      author_name: name,
      author_side: "team",
      body: data.note,
      anchor: null,
      attachments: [],
    });
    if (error) throw new Error((error as { message: string }).message);

    await notifyPortalContacts({
      brandId: data.brandId,
      clientId: data.clientId,
      prefKind: "comments",
      title: "A equipe respondeu seu comentário",
      body: (post as { title?: string | null }).title ?? null,
      href: `/area/aprovacoes?cliente=${data.clientId}`,
      dedupeParts: ["post_reply", postId, now],
      payload: { post_id: postId },
    });
    return { ok: true };
  });

/** Lê a conversa completa de um pedido (equipe). */
export const getClientInboxRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ clientId: z.string().uuid(), requestId: z.string().uuid() }).parse(i),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      title: string;
      status: string;
      events: Array<{
        id: string;
        kind: string;
        note: string | null;
        actorName: string | null;
        actorSide: "client" | "team";
        createdAt: string;
      }>;
    }> => {
      const sb = context.supabase as AnyClient;
      const { data: row } = await sb
        .from("client_requests")
        .select("id, title, status")
        .eq("id", data.requestId)
        .eq("client_id", data.clientId)
        .maybeSingle();
      if (!row) throw new Error("request_not_found");
      const { data: events } = await sb
        .from("client_request_events")
        .select("id, kind, note, actor_name, actor_side, created_at")
        .eq("request_id", data.requestId)
        .order("created_at", { ascending: true });
      return {
        title: (row as { title: string }).title,
        status: (row as { status: string }).status,
        events: ((events ?? []) as Array<Record<string, any>>).map((e) => ({
          id: e["id"],
          kind: e["kind"],
          note: e["note"] ?? null,
          actorName: e["actor_name"] ?? null,
          actorSide: (e["actor_side"] ?? "team") as "client" | "team",
          createdAt: e["created_at"],
        })),
      };
    },
  );
