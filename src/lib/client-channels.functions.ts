import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { connectionDisplayName } from "@/lib/channel-display-name";

/**
 * Vínculo N:N entre clientes e contas sociais (social_connections) do
 * workspace/marca. As contas são conectadas globalmente em /connections
 * e atribuídas a cada cliente a partir do perfil do cliente.
 *
 * FONTE DE VERDADE (Fase 1/2): `client_social_accounts`.
 * O campo legado `social_connections.client_id` NUNCA é consultado aqui.
 */

export type ClientChannelRow = {
  connectionId: string;
  channel: string;
  provider: string;
  accountLabel: string;
  handle: string | null;
  avatarUrl: string | null;
  status: string;
  assigned: boolean;
};

const ListInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
});

export const listClientChannelAssignmentsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }): Promise<ClientChannelRow[]> => {
    const [connsRes, assignsRes] = await Promise.all([
      context.supabase
        .from("social_connections")
        .select("id, provider, channel, external_name, account_username, status, metadata")
        .eq("brand_id", data.brandId)
        .in("status", ["active", "attention"])
        .order("channel", { ascending: true }),
      context.supabase
        .from("client_social_accounts")
        .select("connection_id")
        .eq("client_id", data.clientId),
    ]);
    if (connsRes.error) throw new Error(connsRes.error.message);
    if (assignsRes.error) throw new Error(assignsRes.error.message);

    const assigned = new Set((assignsRes.data ?? []).map((r) => r.connection_id));

    return (connsRes.data ?? []).map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const avatar =
        r.channel === "instagram"
          ? ((meta.instagram_picture_url ?? meta.page_picture_url ?? null) as string | null)
          : r.channel === "facebook"
            ? ((meta.page_picture_url ?? null) as string | null)
            : null;
      const handle =
        r.channel === "instagram" ? (r.account_username ?? null) : (r.external_name ?? null);
      return {
        connectionId: r.id as string,
        channel: r.channel as string,
        provider: r.provider as string,
        accountLabel: connectionDisplayName(r as any),
        handle,
        avatarUrl: avatar,
        status: r.status as string,
        assigned: assigned.has(r.id),
      };
    });
  });

const ToggleInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  connectionId: z.string().uuid(),
  assigned: z.boolean(),
});

export const toggleClientChannelFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ToggleInput.parse(i))
  .handler(async ({ data, context }) => {
    // Sanity: a conexão deve pertencer à marca antes de atribuir.
    const { data: conn, error: cErr } = await context.supabase
      .from("social_connections")
      .select("id, brand_id")
      .eq("id", data.connectionId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!conn) throw new Error("Conta social não pertence a esta marca.");

    if (data.assigned) {
      // Exclusividade: a conta não pode estar vinculada a outro cliente.
      const { data: existing, error: exErr } = await context.supabase
        .from("client_social_accounts")
        .select("client_id, clients:client_id(name)")
        .eq("connection_id", data.connectionId)
        .neq("client_id", data.clientId);
      if (exErr) throw new Error(exErr.message);
      if (existing?.length) {
        const owner =
          (existing[0] as { clients?: { name: string } | null }).clients?.name ?? "outro cliente";
        throw new Error(
          `Esta conta já está vinculada ao cliente ${owner}. Desvincule-a antes de atribuir a outro cliente.`,
        );
      }

      const { error } = await context.supabase.from("client_social_accounts").upsert(
        {
          brand_id: data.brandId,
          client_id: data.clientId,
          connection_id: data.connectionId,
          created_by: context.userId,
        },
        { onConflict: "client_id,connection_id" },
      );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase
        .from("client_social_accounts")
        .delete()
        .eq("client_id", data.clientId)
        .eq("connection_id", data.connectionId);
      if (error) throw new Error(error.message);
    }
    return { ok: true, assigned: data.assigned };
  });
// ---------------------------------------------------------------------------
// Canais VINCULADOS a um cliente (fonte de verdade: client_social_accounts)
// Usado pelo editor de peça, calendário e perfil do cliente.
// ---------------------------------------------------------------------------

export type LinkedChannel = {
  connectionId: string;
  channel: string;
  provider: string;
  accountLabel: string;
  handle: string | null;
  avatarUrl: string | null;
  status: string;
  pageId: string | null;
  instagramBusinessId: string | null;
};

export const listClientLinkedChannelsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }): Promise<LinkedChannel[]> => {
    const { data: links, error: lErr } = await context.supabase
      .from("client_social_accounts")
      .select("connection_id")
      .eq("client_id", data.clientId)
      .eq("brand_id", data.brandId);
    if (lErr) throw new Error(lErr.message);
    const ids = (links ?? []).map((l) => l.connection_id);
    if (!ids.length) return [];

    const { data: rows, error } = await context.supabase
      .from("social_connections")
      .select(
        "id, provider, channel, external_name, account_username, status, metadata, page_id, instagram_business_id, channel_name",
      )
      .eq("brand_id", data.brandId)
      .in("id", ids)
      .in("status", ["active", "attention"])
      .order("channel", { ascending: true });
    if (error) throw new Error(error.message);

    return (rows ?? []).map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const avatar =
        r.channel === "instagram"
          ? ((meta.instagram_picture_url ?? meta.page_picture_url ?? null) as string | null)
          : r.channel === "facebook"
            ? ((meta.page_picture_url ?? null) as string | null)
            : null;
      const handle =
        r.channel === "instagram"
          ? (r.account_username ?? r.channel_name ?? null)
          : (r.external_name ?? r.channel_name ?? null);
      return {
        connectionId: r.id,
        channel: r.channel,
        provider: r.provider,
        accountLabel: connectionDisplayName(r as any),
        handle,
        avatarUrl: avatar,
        status: r.status,
        pageId: r.page_id ?? null,
        instagramBusinessId: r.instagram_business_id ?? null,
      };
    });
  });

// ---------------------------------------------------------------------------
// Canais do WORKSPACE + clientes vinculados — tela Integrações
// ---------------------------------------------------------------------------

export type WorkspaceChannel = LinkedChannel & {
  clients: Array<{ id: string; name: string }>;
  createdAt: string;
  lastSyncedAt: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  scopes: string[];
  externalId: string;
};

export const listWorkspaceChannelsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ brandId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<WorkspaceChannel[]> => {
    const { data: rows, error } = await context.supabase
      .from("social_connections")
      .select(
        "id, provider, channel, external_name, account_username, status, metadata, page_id, instagram_business_id, channel_name, created_at, last_synced_at, token_expires_at, last_error, scopes, external_id",
      )
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!rows?.length) return [];

    const { data: links, error: lErr } = await context.supabase
      .from("client_social_accounts")
      .select("connection_id, client_id, clients:client_id(id, name)")
      .eq("brand_id", data.brandId);
    if (lErr) throw new Error(lErr.message);

    const byConn = new Map<string, Array<{ id: string; name: string }>>();
    for (const l of links ?? []) {
      const c = (l as { clients?: { id: string; name: string } | null }).clients;
      if (!c) continue;
      const arr = byConn.get(l.connection_id) ?? [];
      arr.push({ id: c.id, name: c.name });
      byConn.set(l.connection_id, arr);
    }

    return rows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const avatar =
        r.channel === "instagram"
          ? ((meta.instagram_picture_url ?? meta.page_picture_url ?? null) as string | null)
          : r.channel === "facebook"
            ? ((meta.page_picture_url ?? null) as string | null)
            : null;
      const handle =
        r.channel === "instagram"
          ? (r.account_username ?? r.channel_name ?? null)
          : (r.external_name ?? r.channel_name ?? null);
      return {
        connectionId: r.id,
        channel: r.channel,
        provider: r.provider,
        accountLabel: connectionDisplayName(r as any),
        handle,
        avatarUrl: avatar,
        status: r.status,
        pageId: r.page_id ?? null,
        instagramBusinessId: r.instagram_business_id ?? null,
        clients: byConn.get(r.id) ?? [],
        createdAt: r.created_at,
        lastSyncedAt: r.last_synced_at ?? null,
        tokenExpiresAt: r.token_expires_at ?? null,
        lastError: r.last_error ?? null,
        scopes: (r.scopes ?? []) as string[],
        externalId: r.external_id,
      };
    });
  });
