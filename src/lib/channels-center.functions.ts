import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/access-guard";

/**
 * Central de Canais — leituras/auditoria de apresentação.
 *
 * NÃO altera regras de isolamento, publicação ou autorização: o vínculo
 * continua sendo feito por `client_social_accounts` (via
 * `toggleClientChannelFn`) e a conexão ativa continua sendo
 * `social_connections`. Aqui apenas lemos histórico real e registramos
 * auditoria em `activity_events`.
 */

export type ChannelHistoryEntry = {
  id: string;
  at: string;
  channel: string;
  accountLabel: string;
  externalId: string | null;
  clientName: string | null;
  action: string;
  actionLabel: string;
  detail: string | null;
  /** "event" = auditoria; "connection" = conexão em estado não operacional. */
  source: "event" | "connection";
};

const ACTION_LABEL: Record<string, string> = {
  channel_disconnected: "Removida",
  channel_revoked: "Revogada pela Meta",
  channel_unlinked: "Desvinculada",
  channel_linked: "Vinculada",
  channel_reconnected: "Reconectada",
  channel_account_changed: "Conta alterada",
};

const BrandInput = z.object({ brandId: z.string().uuid() });

export const listChannelHistoryFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BrandInput.parse(i))
  .handler(async ({ data, context }): Promise<ChannelHistoryEntry[]> => {
    const [eventsRes, staleRes] = await Promise.all([
      context.supabase
        .from("activity_events")
        .select("id, verb, payload, created_at, client_id, entity_id, entity_type")
        .eq("brand_id", data.brandId)
        .eq("entity_type", "social_connection")
        .order("created_at", { ascending: false })
        .limit(120),
      context.supabase
        .from("social_connections")
        .select(
          "id, channel, external_id, external_name, account_username, status, last_error, updated_at",
        )
        .eq("brand_id", data.brandId)
        .not("status", "in", "(active,attention)")
        .order("updated_at", { ascending: false })
        .limit(60),
    ]);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    if (staleRes.error) throw new Error(staleRes.error.message);

    const fromEvents: ChannelHistoryEntry[] = (eventsRes.data ?? []).map((row) => {
      const p = (row.payload ?? {}) as Record<string, unknown>;
      const verb = row.verb as string;
      return {
        id: row.id as string,
        at: row.created_at as string,
        channel: (p.channel as string) ?? "—",
        accountLabel: (p.account_label as string) ?? "—",
        externalId: (p.external_id as string) ?? null,
        clientName: (p.client_name as string) ?? null,
        action: verb,
        actionLabel: ACTION_LABEL[verb] ?? verb,
        detail: (p.detail as string) ?? null,
        source: "event",
      };
    });

    const fromConnections: ChannelHistoryEntry[] = (staleRes.data ?? []).map((r) => ({
      id: `conn:${r.id}`,
      at: r.updated_at as string,
      channel: r.channel as string,
      accountLabel:
        (r.external_name as string | null) ??
        (r.account_username as string | null) ??
        (r.channel as string),
      externalId: (r.external_id as string | null) ?? null,
      clientName: null,
      action: "channel_revoked",
      actionLabel:
        r.status === "revoked"
          ? "Revogada pela Meta"
          : r.status === "expired"
            ? "Autorização expirada"
            : "Indisponível",
      detail: (r.last_error as string | null) ?? null,
      source: "connection",
    }));

    return [...fromEvents, ...fromConnections].sort((a, b) => (a.at < b.at ? 1 : -1));
  });

const RecordInput = z.object({
  brandId: z.string().uuid(),
  connectionId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  verb: z.enum([
    "channel_disconnected",
    "channel_revoked",
    "channel_unlinked",
    "channel_linked",
    "channel_reconnected",
    "channel_account_changed",
  ]),
  channel: z.string().max(40),
  accountLabel: z.string().max(200),
  externalId: z.string().max(120).nullable().optional(),
  clientName: z.string().max(200).nullable().optional(),
  detail: z.string().max(500).nullable().optional(),
});

/**
 * Registra auditoria de canal (best-effort). `activity_events` só possui
 * policy de SELECT, então a escrita usa o cliente administrativo — depois de
 * confirmar que o usuário é membro da marca via `context.supabase`.
 */
export const recordChannelEventFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RecordInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: brand, error } = await context.supabase
      .from("brands")
      .select("id")
      .eq("id", data.brandId)
      .maybeSingle();
    if (error || !brand) return { ok: false };

    // Nunca confiar no `clientId` vindo do frontend antes do bypass de RLS.
    if (data.clientId) {
      try {
        await assertClientScope(context.supabase as never, context.userId, data.clientId);
      } catch {
        return { ok: false };
      }
    }

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("activity_events").insert({
        brand_id: data.brandId,
        client_id: data.clientId ?? null,
        actor_id: context.userId,
        entity_type: "social_connection",
        entity_id: data.connectionId ?? null,
        verb: data.verb,
        payload: {
          channel: data.channel,
          account_label: data.accountLabel,
          external_id: data.externalId ?? null,
          client_name: data.clientName ?? null,
          detail: data.detail ?? null,
        },
      });
      return { ok: true };
    } catch {
      // Auditoria nunca bloqueia a operação do usuário.
      return { ok: false };
    }
  });
