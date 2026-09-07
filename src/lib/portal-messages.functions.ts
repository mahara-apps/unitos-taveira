import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePortalSessionScope } from "@/lib/portal-permissions.server";
import { detectLinkSource, normalizeLinkUrl } from "@/lib/link-source";
import { MAX_MESSAGE_LENGTH, MAX_MESSAGE_LINKS, type MessageLink } from "@/lib/messaging";

/**
 * Mensagens no Portal do Cliente (módulo `messages`).
 *
 * O cliente só alcança conversas do PRÓPRIO cliente marcadas como
 * compartilhadas e nas quais foi incluído — isso é garantido no banco por
 * `can_access_message_thread` + RLS. Aqui apenas validamos o vínculo e o nível
 * do módulo (`resolvePortalSessionScope`) e projetamos campos seguros.
 */

export type PortalThread = {
  id: string;
  subject: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  unread: number;
};

export type PortalMessage = {
  id: string;
  body: string;
  links: MessageLink[];
  authorName: string;
  authorKind: "team" | "portal_client";
  mine: boolean;
  removed: boolean;
  createdAt: string;
};

const ClientIn = z.object({ clientId: z.string().uuid() });

type AnyClient = { from: (table: string) => any; rpc: (fn: string, args?: unknown) => any };

function parseLinks(raw: unknown): MessageLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
    .map((l) => ({
      url: typeof l["url"] === "string" ? (l["url"] as string) : "",
      title: typeof l["title"] === "string" ? (l["title"] as string) : null,
      source: typeof l["source"] === "string" ? (l["source"] as string) : "link",
    }))
    .filter((l) => !!l.url);
}

export const listPortalThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientIn.parse(i))
  .handler(async ({ data, context }): Promise<PortalThread[]> => {
    const scope = await resolvePortalSessionScope(context.supabase, data.clientId, "messages");
    const sb = context.supabase as unknown as AnyClient;

    const { data: threads, error } = await sb
      .from("message_threads")
      .select("id, subject, last_message_at, last_message_preview")
      .eq("client_id", scope.clientId)
      .eq("scope", "client")
      .eq("visibility", "shared_with_client")
      .is("archived_at", null)
      .order("last_message_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const list = (threads ?? []) as Array<{
      id: string;
      subject: string;
      last_message_at: string;
      last_message_preview: string | null;
    }>;
    if (list.length === 0) return [];

    const { data: unread } = await sb
      .from("message_thread_participants")
      .select("thread_id, last_read_at")
      .eq("user_id", context.userId)
      .in(
        "thread_id",
        list.map((t) => t.id),
      );
    const readAt = new Map(
      ((unread ?? []) as Array<{ thread_id: string; last_read_at: string | null }>).map((p) => [
        p.thread_id,
        p.last_read_at,
      ]),
    );

    const { data: recent } = await sb
      .from("messages")
      .select("thread_id, author_id, created_at")
      .in(
        "thread_id",
        list.map((t) => t.id),
      )
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(500);

    const counts = new Map<string, number>();
    for (const m of (recent ?? []) as Array<{
      thread_id: string;
      author_id: string;
      created_at: string;
    }>) {
      if (m.author_id === context.userId) continue;
      const since = readAt.get(m.thread_id) ?? null;
      if (since && new Date(m.created_at) <= new Date(since)) continue;
      counts.set(m.thread_id, (counts.get(m.thread_id) ?? 0) + 1);
    }

    return list.map((t) => ({
      id: t.id,
      subject: t.subject,
      lastMessageAt: t.last_message_at,
      lastMessagePreview: t.last_message_preview,
      unread: counts.get(t.id) ?? 0,
    }));
  });

export const listPortalMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientIn.extend({ threadId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<PortalMessage[]> => {
    await resolvePortalSessionScope(context.supabase, data.clientId, "messages");
    const sb = context.supabase as unknown as AnyClient;

    const { data: rows, error } = await sb
      .from("messages")
      .select("id, author_id, author_kind, body, links, removed_at, created_at")
      .eq("thread_id", data.threadId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as Array<{
      id: string;
      author_id: string;
      author_kind: string;
      body: string;
      links: unknown;
      removed_at: string | null;
      created_at: string;
    }>;
    const authorIds = [...new Set(list.map((r) => r.author_id))];
    const { data: profiles } = authorIds.length
      ? await sb.from("user_profiles").select("id, full_name, email").in("id", authorIds)
      : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
    const nameOf = new Map(
      ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
        (p) => [p.id, p.full_name ?? p.email ?? "Equipe"],
      ),
    );

    return list
      .map((r) => ({
        id: r.id,
        body: r.removed_at ? "" : r.body,
        links: r.removed_at ? [] : parseLinks(r.links),
        authorName: nameOf.get(r.author_id) ?? "Equipe",
        authorKind: r.author_kind === "portal_client" ? ("portal_client" as const) : ("team" as const),
        mine: r.author_id === context.userId,
        removed: !!r.removed_at,
        createdAt: r.created_at,
      }))
      .reverse();
  });

export const sendPortalMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    ClientIn.extend({
      threadId: z.string().uuid(),
      body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
      links: z
        .array(z.object({ url: z.string().min(1), title: z.string().nullish() }))
        .max(MAX_MESSAGE_LINKS)
        .default([]),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await resolvePortalSessionScope(context.supabase, data.clientId, "messages", "interact");
    const sb = context.supabase as unknown as AnyClient;

    const links: MessageLink[] = [];
    for (const l of data.links) {
      const url = normalizeLinkUrl(l.url);
      if (!url || links.some((x) => x.url === url)) continue;
      links.push({ url, title: l.title?.trim() || null, source: detectLinkSource(url) });
    }

    const { data: row, error } = await sb
      .from("messages")
      .insert({
        thread_id: data.threadId,
        author_id: context.userId,
        author_kind: "portal_client",
        body: data.body,
        links,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: (row as { id: string }).id };
  });

export const markPortalThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientIn.extend({ threadId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await resolvePortalSessionScope(context.supabase, data.clientId, "messages");
    const sb = context.supabase as unknown as AnyClient;
    await sb
      .from("message_thread_participants")
      .update({ last_read_at: new Date().toISOString() })
      .eq("thread_id", data.threadId)
      .eq("user_id", context.userId);
    return { ok: true };
  });
