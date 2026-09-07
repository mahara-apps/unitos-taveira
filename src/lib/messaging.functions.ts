/**
 * Comunicador interno — server functions.
 *
 * Regras não negociáveis:
 * - Acesso é decidido pelo banco: RLS + `can_access_message_thread`. Aqui só
 *   revalidamos escopo (defesa em profundidade) e nunca usamos admin client.
 * - Isolamento do Portal: contato de cliente só alcança conversas
 *   `scope = 'client'` com `visibility = 'shared_with_client'` do SEU cliente.
 * - Sem anexos: só corpo de texto e LINKS (mesma decisão dos pedidos).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callRpc } from "@/lib/supabase-rpc";
import { assertClientScope, assertModuleAccess, resolveAuthorityRole } from "@/lib/access-guard";
import { detectLinkSource, linkFallbackLabel, normalizeLinkUrl } from "@/lib/link-source";
import { displayName } from "@/lib/identity";
import { notifyMentionsSafe } from "@/lib/mention-notify.server";
import { insertNotificationsDeduped, notificationDedupeKey } from "@/lib/notifications-dedupe";
import {
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGE_LINKS,
  normalizeThreadScope,
  normalizeVisibility,
  previewOf,
  sortThreads,
  type MessageItem,
  type MessageLink,
  type ThreadParticipant,
  type ThreadParticipantRole,
  type ThreadSummary,
} from "@/lib/messaging";

const uuid = z.string().uuid();

const linkInput = z.object({
  url: z.string().min(3).max(2000),
  title: z.string().trim().max(160).nullish(),
});

/** Normaliza/dedup dos links e descarta URLs inválidas. */
function normalizeLinks(raw: Array<{ url: string; title?: string | null }>): MessageLink[] {
  const out: MessageLink[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const url = normalizeLinkUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: (item.title ?? "").trim() || linkFallbackLabel(url),
      source: detectLinkSource(url),
    });
    if (out.length >= MAX_MESSAGE_LINKS) break;
  }
  return out;
}

function parseLinks(value: unknown): MessageLink[] {
  if (!Array.isArray(value)) return [];
  return normalizeLinks(
    value
      .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
      .map((v) => ({
        url: typeof v["url"] === "string" ? v["url"] : "",
        title: typeof v["title"] === "string" ? v["title"] : null,
      })),
  );
}

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

/** Perfis usados para nomear autores e participantes. */
async function loadProfiles(
  supabase: { from: (t: "user_profiles") => never },
  ids: string[],
): Promise<Map<string, ProfileRow>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Map();
  const query = supabase.from("user_profiles") as unknown as {
    select: (cols: string) => {
      in: (
        c: string,
        v: string[],
      ) => Promise<{ data: ProfileRow[] | null; error: { message: string } | null }>;
    };
  };
  const { data } = await query.select("id, full_name, email, avatar_url").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p]));
}

const nameOf = (p: ProfileRow | undefined, fallback = "Usuário") =>
  displayName({ full_name: p?.full_name ?? null, email: p?.email ?? null }, fallback);

const asParticipantRole = (v: unknown): ThreadParticipantRole =>
  v === "portal_client" ? "portal_client" : "team";

/* ------------------------------------------------------------------ */
/* Leitura de conversas                                                */
/* ------------------------------------------------------------------ */

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: uuid,
        scope: z.enum(["all", "client", "team_dm", "project"]).default("all"),
        clientId: uuid.nullish(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ThreadSummary[]> => {
    const { supabase, userId } = context;
    await assertModuleAccess(supabase, userId, data.brandId, "chat", "view");

    let query = supabase
      .from("message_threads")
      .select(
        "id, scope, subject, visibility, client_id, project_id, last_message_at, last_message_preview",
      )
      .eq("brand_id", data.brandId)
      .is("archived_at", null)
      .order("last_message_at", { ascending: false })
      .limit(300);
    if (data.scope !== "all") query = query.eq("scope", data.scope);
    if (data.clientId) query = query.eq("client_id", data.clientId);

    const { data: rows, error } = await query;
    if (error) throw error;
    if (!rows?.length) return [];

    const threadIds = rows.map((r) => r.id);

    const [{ data: parts }, { data: clients }, { data: projects }, unread] = await Promise.all([
      supabase
        .from("message_thread_participants")
        .select("thread_id, user_id, role_in_thread, last_read_at")
        .in("thread_id", threadIds),
      supabase
        .from("clients")
        .select("id, name")
        .in(
          "id",
          Array.from(new Set(rows.map((r) => r.client_id).filter((v): v is string => !!v))),
        ),
      supabase
        .from("projects")
        .select("id, name")
        .in(
          "id",
          Array.from(new Set(rows.map((r) => r.project_id).filter((v): v is string => !!v))),
        ),
      callRpc<Array<{ thread_id: string; unread: number }>>(
        supabase,
        "message_unread_counts",
        { _brand_id: data.brandId },
      ),
    ]);

    const profiles = await loadProfiles(
      supabase as never,
      (parts ?? []).map((p) => p.user_id as string),
    );
    const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
    const projectName = new Map((projects ?? []).map((p) => [p.id as string, p.name as string]));
    const unreadMap = new Map((unread.data ?? []).map((u) => [u.thread_id, Number(u.unread) || 0]));

    const byThread = new Map<string, ThreadParticipant[]>();
    for (const p of parts ?? []) {
      const prof = profiles.get(p.user_id as string);
      const list = byThread.get(p.thread_id as string) ?? [];
      list.push({
        userId: p.user_id as string,
        name: nameOf(prof),
        email: prof?.email ?? null,
        avatarUrl: prof?.avatar_url ?? null,
        roleInThread: asParticipantRole(p.role_in_thread),
        lastReadAt: (p.last_read_at as string | null) ?? null,
      });
      byThread.set(p.thread_id as string, list);
    }

    const lastAuthorName = new Map<string, string>();
    const { data: lastMsgs } = await supabase
      .from("messages")
      .select("thread_id, author_id, created_at")
      .in("thread_id", threadIds)
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(600);
    const lastAuthorIds = new Map<string, string>();
    for (const m of lastMsgs ?? []) {
      if (!lastAuthorIds.has(m.thread_id as string)) {
        lastAuthorIds.set(m.thread_id as string, m.author_id as string);
      }
    }
    const authorProfiles = await loadProfiles(
      supabase as never,
      [...lastAuthorIds.values()],
    );
    for (const [threadId, authorId] of lastAuthorIds) {
      lastAuthorName.set(threadId, nameOf(authorProfiles.get(authorId)));
    }

    return sortThreads(
      rows.map((r) => ({
        id: r.id as string,
        scope: normalizeThreadScope(r.scope),
        subject: (r.subject as string) ?? "",
        visibility: normalizeVisibility(r.visibility),
        clientId: (r.client_id as string | null) ?? null,
        clientName: r.client_id ? (clientName.get(r.client_id as string) ?? null) : null,
        projectId: (r.project_id as string | null) ?? null,
        projectName: r.project_id ? (projectName.get(r.project_id as string) ?? null) : null,
        lastMessageAt: r.last_message_at as string,
        lastMessagePreview: (r.last_message_preview as string | null) ?? null,
        lastAuthorName: lastAuthorName.get(r.id as string) ?? null,
        unread: unreadMap.get(r.id as string) ?? 0,
        participants: byThread.get(r.id as string) ?? [],
      })),
    );
  });

export const listMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ threadId: uuid, limit: z.number().int().min(10).max(300).default(120) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<MessageItem[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("messages")
      .select("id, thread_id, author_id, author_kind, body, links, mentions, removed_at, created_at")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw error;

    const profiles = await loadProfiles(
      supabase as never,
      (rows ?? []).map((r) => r.author_id as string),
    );

    return (rows ?? [])
      .map((r) => {
        const prof = profiles.get(r.author_id as string);
        return {
          id: r.id as string,
          threadId: r.thread_id as string,
          authorId: r.author_id as string,
          authorName: nameOf(prof),
          authorEmail: prof?.email ?? null,
          authorAvatarUrl: prof?.avatar_url ?? null,
          authorKind: asParticipantRole(r.author_kind),
          body: (r.removed_at ? "" : (r.body as string)) ?? "",
          links: r.removed_at ? [] : parseLinks(r.links),
          mentions: (r.mentions as string[] | null) ?? [],
          removedAt: (r.removed_at as string | null) ?? null,
          createdAt: r.created_at as string,
        } satisfies MessageItem;
      })
      .reverse();
  });

export const countUnreadMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ brandId: uuid.nullish() }).parse(i))
  .handler(async ({ data, context }): Promise<number> => {
    const { data: total, error } = await callRpc<number>(
      context.supabase,
      "message_unread_total",
      { _brand_id: data.brandId ?? null },
    );
    if (error) return 0;
    return Number(total) || 0;
  });

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

export const createThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: uuid,
        scope: z.enum(["client", "team_dm", "project"]),
        subject: z.string().trim().min(2).max(160),
        clientId: uuid.nullish(),
        projectId: uuid.nullish(),
        visibility: z.enum(["internal", "shared_with_client"]).default("internal"),
        participantIds: z.array(uuid).max(50).default([]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    await assertModuleAccess(supabase, userId, data.brandId, "chat", "own");

    // Escopo: conversa de cliente/projeto exige cliente acessível ao autor.
    if (data.scope !== "team_dm") {
      if (!data.clientId) throw new Error("Selecione o cliente da conversa");
      await assertClientScope(supabase, userId, data.clientId);
    }
    const visibility = data.scope === "client" ? data.visibility : "internal";

    const { data: created, error } = await supabase
      .from("message_threads")
      .insert({
        brand_id: data.brandId,
        scope: data.scope,
        subject: data.subject,
        visibility,
        client_id: data.scope === "team_dm" ? null : (data.clientId ?? null),
        project_id: data.scope === "project" ? (data.projectId ?? null) : null,
        created_by: userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    const threadId = created.id as string;

    await addParticipantsInternal(supabase, {
      threadId,
      brandId: data.brandId,
      clientId: data.scope === "team_dm" ? null : (data.clientId ?? null),
      userIds: Array.from(new Set([userId, ...data.participantIds])),
      visibility,
    });

    return { id: threadId };
  });

/** Insere participantes validando vínculo (equipe do workspace ou contato do cliente). */
async function addParticipantsInternal(
  supabase: (typeof import("@/integrations/supabase/client"))["supabase"],
  input: {
    threadId: string;
    brandId: string;
    clientId: string | null;
    userIds: string[];
    visibility: string;
  },
): Promise<number> {
  const ids = Array.from(new Set(input.userIds.filter(Boolean)));
  if (!ids.length) return 0;

  const { data: members } = await supabase
    .from("brand_members")
    .select("user_id, role")
    .eq("brand_id", input.brandId)
    .in("user_id", ids);
  const teamIds = new Set(
    (members ?? [])
      .filter((m) => (m.role as string) !== "client")
      .map((m) => m.user_id as string),
  );

  // Contatos do cliente só entram em conversa compartilhada daquele cliente.
  const portalIds = new Set<string>();
  if (input.clientId && input.visibility === "shared_with_client") {
    const { data: contacts } = await supabase
      .from("client_members")
      .select("user_id, role")
      .eq("client_id", input.clientId)
      .in("user_id", ids);
    for (const c of contacts ?? []) {
      if ((c.role as string) === "portal_client") portalIds.add(c.user_id as string);
    }
  }

  const rows = ids
    .filter((id) => teamIds.has(id) || portalIds.has(id))
    .map((id) => ({
      thread_id: input.threadId,
      user_id: id,
      role_in_thread: portalIds.has(id) && !teamIds.has(id) ? "portal_client" : "team",
    }));
  if (!rows.length) return 0;

  const { error } = await supabase
    .from("message_thread_participants")
    .upsert(rows, { onConflict: "thread_id,user_id" });
  if (error) throw error;
  return rows.length;
}

export const addThreadParticipants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ threadId: uuid, userIds: z.array(uuid).min(1).max(50) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ added: number }> => {
    const { supabase, userId } = context;
    const { data: thread, error } = await supabase
      .from("message_threads")
      .select("id, brand_id, client_id, visibility")
      .eq("id", data.threadId)
      .single();
    if (error) throw error;
    await assertModuleAccess(supabase, userId, thread.brand_id as string, "chat", "own");

    const added = await addParticipantsInternal(supabase, {
      threadId: data.threadId,
      brandId: thread.brand_id as string,
      clientId: (thread.client_id as string | null) ?? null,
      userIds: data.userIds,
      visibility: thread.visibility as string,
    });
    return { added };
  });

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        threadId: uuid,
        body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
        links: z.array(linkInput).max(MAX_MESSAGE_LINKS).default([]),
        mentions: z.array(uuid).max(50).default([]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;

    // RLS já barra thread inacessível; a leitura garante contexto para notificar.
    const { data: thread, error: threadErr } = await supabase
      .from("message_threads")
      .select("id, brand_id, scope, subject, client_id, visibility")
      .eq("id", data.threadId)
      .single();
    if (threadErr) throw threadErr;

    const role = await resolveAuthorityRole(supabase, userId, thread.brand_id as string);
    const authorKind: ThreadParticipantRole = role === "client" ? "portal_client" : "team";

    const links = normalizeLinks(data.links);
    const { data: created, error } = await supabase
      .from("messages")
      .insert({
        thread_id: data.threadId,
        author_id: userId,
        author_kind: authorKind,
        body: data.body,
        links,
        mentions: data.mentions,
      })
      .select("id")
      .single();
    if (error) throw error;

    // Leitura própria em dia + notificações best-effort.
    await supabase
      .from("message_thread_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", data.threadId)
      .eq("user_id", userId);

    await notifyThreadSafe(supabase, {
      threadId: data.threadId,
      brandId: thread.brand_id as string,
      subject: (thread.subject as string) ?? "Mensagem",
      body: data.body,
      authorId: userId,
      authorKind,
      messageId: created.id as string,
      mentions: data.mentions,
    });

    return { id: created.id as string };
  });

export const markThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ threadId: uuid }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("message_thread_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", data.threadId)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const removeMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ messageId: uuid }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    // Histórico nunca é apagado: marcamos `removed_at` (RLS limita ao autor).
    const { error } = await context.supabase
      .from("messages")
      .update({ removed_at: new Date().toISOString() })
      .eq("id", data.messageId)
      .eq("author_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Notificações (best-effort)                                          */
/* ------------------------------------------------------------------ */

async function notifyThreadSafe(
  supabase: (typeof import("@/integrations/supabase/client"))["supabase"],
  input: {
    threadId: string;
    brandId: string;
    subject: string;
    body: string;
    authorId: string;
    authorKind: ThreadParticipantRole;
    messageId: string;
    mentions: string[];
  },
): Promise<void> {
  try {
    const { data: parts } = await supabase
      .from("message_thread_participants")
      .select("user_id, notify")
      .eq("thread_id", input.threadId);
    const targets = (parts ?? [])
      .filter((p) => p.notify !== false && (p.user_id as string) !== input.authorId)
      .map((p) => p.user_id as string);
    if (targets.length) {
      const authorProfiles = await loadProfiles(supabase as never, [input.authorId]);
      const authorName = nameOf(authorProfiles.get(input.authorId));
      await insertNotificationsDeduped(
        supabase as never,
        targets.map((target) => ({
          user_id: target,
          brand_id: input.brandId,
          kind: "message",
          title: `${authorName} · ${input.subject}`,
          body: previewOf(input.body),
          href: `/messages/${input.threadId}`,
          payload: {
            thread_id: input.threadId,
            message_id: input.messageId,
            author_id: input.authorId,
            author_kind: input.authorKind,
          },
          dedupe_key: notificationDedupeKey("message", input.messageId, target),
        })),
      );
    }
  } catch (e) {
    console.error("[messages] falha ao notificar participantes", (e as Error)?.message);
  }

  if (input.mentions.length) {
    await notifyMentionsSafe(supabase as never, {
      brandId: input.brandId,
      authorId: input.authorId,
      mentions: input.mentions,
      commentId: input.messageId,
      title: `Menção em ${input.subject}`,
      body: input.body,
      href: `/messages/${input.threadId}`,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Contatos disponíveis para uma conversa                              */
/* ------------------------------------------------------------------ */

export const listThreadCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: uuid, clientId: uuid.nullish() }).parse(i),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      team: Array<{ id: string; name: string; email: string | null; avatarUrl: string | null }>;
      clientContacts: Array<{
        id: string;
        name: string;
        email: string | null;
        avatarUrl: string | null;
      }>;
    }> => {
      const { supabase, userId } = context;
      await assertModuleAccess(supabase, userId, data.brandId, "chat", "view");

      const { data: members } = await supabase
        .from("brand_members")
        .select("user_id, role")
        .eq("brand_id", data.brandId);
      const teamIds = (members ?? [])
        .filter((m) => (m.role as string) !== "client")
        .map((m) => m.user_id as string);

      let contactIds: string[] = [];
      if (data.clientId) {
        await assertClientScope(supabase, userId, data.clientId);
        const { data: contacts } = await supabase
          .from("client_members")
          .select("user_id, role")
          .eq("client_id", data.clientId);
        contactIds = (contacts ?? [])
          .filter((c) => (c.role as string) === "portal_client")
          .map((c) => c.user_id as string);
      }

      const profiles = await loadProfiles(supabase as never, [...teamIds, ...contactIds]);
      const shape = (id: string) => {
        const p = profiles.get(id);
        return {
          id,
          name: nameOf(p),
          email: p?.email ?? null,
          avatarUrl: p?.avatar_url ?? null,
        };
      };

      return {
        team: teamIds.map(shape).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        clientContacts: contactIds
          .map(shape)
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      };
    },
  );
