import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePortalSessionScope } from "@/lib/portal-permissions.server";
import { detectLinkSource, normalizeLinkUrl } from "@/lib/link-source";

/**
 * Pedidos do cliente (módulo `requests` do Portal).
 *
 * O cliente abre uma solicitação, acompanha a situação e conversa com a equipe.
 * Todo acesso passa por `resolvePortalSessionScope`, que valida vínculo com o
 * cliente E o nível do módulo — link sem senha não cria nem comenta nada.
 */

export const PORTAL_REQUEST_STATUS = [
  "submitted",
  "info_needed",
  "accepted",
  "in_production",
  "done",
  "rejected",
  "cancelled",
] as const;

export type PortalRequestStatus = (typeof PORTAL_REQUEST_STATUS)[number];

export const PORTAL_REQUEST_STATUS_LABEL: Record<PortalRequestStatus, string> = {
  submitted: "Enviado",
  info_needed: "Aguardando você",
  accepted: "Aceito",
  in_production: "Em produção",
  done: "Concluído",
  rejected: "Recusado",
  cancelled: "Cancelado",
};

export type PortalRequestAttachment = {
  name: string;
  path: string;
  mime: string | null;
  size: number;
  url?: string | null;
};

export type PortalRequestLink = {
  url: string;
  title: string | null;
  source: string;
};

export const MAX_REQUEST_LINKS = 10;

export type PortalRequest = {
  id: string;
  title: string;
  description: string | null;
  status: PortalRequestStatus;
  desiredDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  decisionNote: string | null;
  attachments: PortalRequestAttachment[];
  links: PortalRequestLink[];
};

export type PortalRequestEvent = {
  id: string;
  kind: string;
  note: string | null;
  actorName: string | null;
  actorSide: "client" | "team";
  createdAt: string;
};

const ClientIn = z.object({ clientId: z.string().uuid() });

type AnyClient = {
  from: (table: string) => any;
};

function normalizeAttachments(raw: unknown): PortalRequestAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      name: typeof a["name"] === "string" ? (a["name"] as string) : "anexo",
      path: typeof a["path"] === "string" ? (a["path"] as string) : "",
      mime: typeof a["mime"] === "string" ? (a["mime"] as string) : null,
      size: typeof a["size"] === "number" ? (a["size"] as number) : 0,
    }))
    .filter((a) => a.path);
}

function normalizeLinks(raw: unknown): PortalRequestLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is Record<string, unknown> => typeof l === "object" && l !== null)
    .map((l) => {
      const url = typeof l["url"] === "string" ? (l["url"] as string) : "";
      return {
        url,
        title: typeof l["title"] === "string" && l["title"] ? (l["title"] as string) : null,
        source: typeof l["source"] === "string" ? (l["source"] as string) : detectLinkSource(url),
      };
    })
    .filter((l) => !!l.url);
}

function mapRequest(row: Record<string, unknown>): PortalRequest {
  return {
    id: row["id"] as string,
    title: row["title"] as string,
    description: (row["description"] as string | null) ?? null,
    status: (row["status"] as PortalRequestStatus) ?? "submitted",
    desiredDueAt: (row["desired_due_at"] as string | null) ?? null,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
    createdByName: (row["created_by_name"] as string | null) ?? null,
    decisionNote: (row["decision_note"] as string | null) ?? null,
    attachments: normalizeAttachments(row["attachments"]),
    links: normalizeLinks(row["links"]),
  };
}

const REQUEST_COLUMNS =
  "id, title, description, status, desired_due_at, created_at, updated_at, created_by_name, decision_note, attachments, links";

async function actorName(supabase: unknown, userId: string): Promise<string | null> {
  const { data } = await (supabase as AnyClient)
    .from("user_profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return ((data as { full_name?: string | null } | null)?.full_name ?? null) || null;
}

/** Avisa a equipe interna (best-effort: nunca invalida o pedido do cliente). */
async function notifyTeam(input: {
  brandId: string;
  clientId: string;
  requestId: string;
  title: string;
  body: string;
  kindKey: string;
}): Promise<void> {
  const { notifyInternalTeam } = await import("@/lib/client-comms.server");
  await notifyInternalTeam({
    brandId: input.brandId,
    clientId: input.clientId,
    title: input.title,
    body: input.body,
    href: `/inbox?cliente=${input.clientId}&tipo=request`,
    dedupeParts: ["client_request", input.kindKey, input.requestId],
    payload: { request_id: input.requestId, inbox_type: "request" },
  });
}

async function signAttachments(items: PortalRequestAttachment[]): Promise<PortalRequestAttachment[]> {
  if (!items.length) return items;
  const { signPortalDocument } = await import("@/lib/portal-media.server");
  return Promise.all(
    items.map(async (a) => ({ ...a, url: await signPortalDocument(a.path) })),
  );
}

export const listPortalRequestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientIn.parse(i))
  .handler(async ({ data, context }): Promise<PortalRequest[]> => {
    const scope = await resolvePortalSessionScope(context.supabase, data.clientId, "requests");
    const { data: rows, error } = await (context.supabase as AnyClient)
      .from("client_requests")
      .select(REQUEST_COLUMNS)
      .eq("client_id", scope.clientId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error((error as { message: string }).message);
    return ((rows ?? []) as Array<Record<string, unknown>>).map(mapRequest);
  });

export const getPortalRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientIn.extend({ requestId: z.string().uuid() }).parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ request: PortalRequest; events: PortalRequestEvent[] }> => {
      const scope = await resolvePortalSessionScope(context.supabase, data.clientId, "requests");
      const sb = context.supabase as AnyClient;
      const { data: row, error } = await sb
        .from("client_requests")
        .select(REQUEST_COLUMNS)
        .eq("id", data.requestId)
        .eq("client_id", scope.clientId)
        .maybeSingle();
      if (error) throw new Error((error as { message: string }).message);
      if (!row) throw new Error("request_not_found");

      const { data: events } = await sb
        .from("client_request_events")
        .select("id, kind, note, actor_name, actor_side, created_at")
        .eq("request_id", data.requestId)
        .order("created_at", { ascending: true });

      const request = mapRequest(row as Record<string, unknown>);
      request.attachments = await signAttachments(request.attachments);
      return {
        request,
        events: ((events ?? []) as Array<Record<string, unknown>>).map((e) => ({
          id: e["id"] as string,
          kind: e["kind"] as string,
          note: (e["note"] as string | null) ?? null,
          actorName: (e["actor_name"] as string | null) ?? null,
          actorSide: (e["actor_side"] as "client" | "team") ?? "team",
          createdAt: e["created_at"] as string,
        })),
      };
    },
  );

export const createPortalRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    ClientIn.extend({
      title: z.string().trim().min(3, "Descreva o pedido em poucas palavras").max(160),
      description: z.string().trim().max(4000).optional(),
      desiredDueAt: z.string().datetime().nullish(),
      links: z
        .array(
          z.object({
            url: z.string().trim().min(4).max(2000),
            title: z.string().trim().max(160).optional(),
          }),
        )
        .max(MAX_REQUEST_LINKS)
        .optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const scope = await resolvePortalSessionScope(
      context.supabase,
      data.clientId,
      "requests",
      "interact",
    );
    const name = await actorName(context.supabase, context.userId);

    const links: PortalRequestLink[] = [];
    for (const raw of data.links ?? []) {
      const url = normalizeLinkUrl(raw.url);
      if (!url) throw new Error("invalid_link");
      if (links.some((l) => l.url === url)) continue;
      links.push({ url, title: raw.title?.trim() || null, source: detectLinkSource(url) });
    }

    const sb = context.supabase as AnyClient;
    const { data: inserted, error } = await sb
      .from("client_requests")
      .insert({
        brand_id: scope.brandId,
        client_id: scope.clientId,
        title: data.title,
        description: data.description?.trim() || null,
        desired_due_at: data.desiredDueAt ?? null,
        created_by: context.userId,
        created_by_name: name,
        attachments: [],
        links,
      })
      .select("id")
      .single();
    if (error) throw new Error((error as { message: string }).message);
    const id = (inserted as { id: string }).id;

    await sb.from("client_request_events").insert({
      request_id: id,
      client_id: scope.clientId,
      actor_id: context.userId,
      actor_name: name,
      actor_side: "client",
      kind: "created",
      note: data.description?.trim() || null,
    });

    await notifyTeam({
      brandId: scope.brandId,
      clientId: scope.clientId,
      requestId: id,
      title: "Novo pedido do cliente",
      body: data.title,
      kindKey: "created",
    });

    return { id };
  });

export const commentPortalRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    ClientIn.extend({
      requestId: z.string().uuid(),
      note: z.string().trim().min(1).max(4000),
    }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const scope = await resolvePortalSessionScope(
      context.supabase,
      data.clientId,
      "requests",
      "interact",
    );
    const sb = context.supabase as AnyClient;
    const { data: row } = await sb
      .from("client_requests")
      .select("id, title")
      .eq("id", data.requestId)
      .eq("client_id", scope.clientId)
      .maybeSingle();
    if (!row) throw new Error("request_not_found");

    const name = await actorName(context.supabase, context.userId);
    const { error } = await sb.from("client_request_events").insert({
      request_id: data.requestId,
      client_id: scope.clientId,
      actor_id: context.userId,
      actor_name: name,
      actor_side: "client",
      kind: "comment",
      note: data.note,
    });
    if (error) throw new Error((error as { message: string }).message);

    await notifyTeam({
      brandId: scope.brandId,
      clientId: scope.clientId,
      requestId: data.requestId,
      title: "Novo comentário em um pedido",
      body: (row as { title: string }).title,
      kindKey: "comment",
    });
    return { ok: true };
  });

export const cancelPortalRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    ClientIn.extend({
      requestId: z.string().uuid(),
      note: z.string().trim().max(1000).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const scope = await resolvePortalSessionScope(
      context.supabase,
      data.clientId,
      "requests",
      "interact",
    );
    const sb = context.supabase as AnyClient;
    const { data: updated, error } = await sb
      .from("client_requests")
      .update({ status: "cancelled", decision_note: data.note?.trim() || null })
      .eq("id", data.requestId)
      .eq("client_id", scope.clientId)
      .in("status", ["submitted", "info_needed"])
      .select("id")
      .maybeSingle();
    if (error) throw new Error((error as { message: string }).message);
    if (!updated) throw new Error("request_not_cancelable");

    const name = await actorName(context.supabase, context.userId);
    await sb.from("client_request_events").insert({
      request_id: data.requestId,
      client_id: scope.clientId,
      actor_id: context.userId,
      actor_name: name,
      actor_side: "client",
      kind: "cancelled",
      note: data.note?.trim() || null,
    });
    return { ok: true };
  });
