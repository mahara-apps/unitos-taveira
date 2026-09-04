import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBrandMember, resolveScopedClientIds } from "@/lib/access-guard";

const MESSAGING_TOOLS = ["whatsapp_evolution", "whatsapp_cloud", "resend"] as const;

const schema = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid().nullish(),
});

export type MessagingKpis = {
  sent30d: number;
  sentPrev30d: number;
  trendPct: number | null;
  delivered30d: number;
  deliveryRate: number | null; // 0..1
  failed7d: number;
  topFailedChannel: string | null;
  brandsTotal: number;
  brandsCovered: number;
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp_evolution: "WhatsApp Evolution",
  whatsapp_cloud: "WhatsApp Cloud API",
  resend: "Resend",
};

export const getMessagingKpis = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => schema.parse(data))
  .handler(async ({ data, context }): Promise<MessagingKpis> => {
    const { supabase, userId } = context;

    // FASE 10B: o brandId/clientId vindo do frontend nunca é autorização.
    // Revalida a associação ao workspace e resolve o escopo real de clientes
    // (admin → workspace inteiro; manager/user → somente atribuídos).
    await assertBrandMember(supabase, userId, data.brandId);
    const scopedClientIds = await resolveScopedClientIds(
      supabase,
      data.brandId,
      data.clientId ?? null,
    );

    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    /** Aplica escopo de cliente à query (mesma regra da RLS de message_logs). */
    const scoped = <T extends { in: (c: string, v: string[]) => T }>(q: T): T =>
      scopedClientIds ? q.in("client_id", scopedClientIds) : q;

    // Sent last 30d
    const sent30dQ = await scoped(
      supabase
        .from("message_logs")
        .select("id, status", { count: "exact", head: false })
        .eq("brand_id", data.brandId)
        .gte("sent_at", d30),
    );


    const rows30 = sent30dQ.data ?? [];
    const sent30d = rows30.length;
    const delivered30d = rows30.filter((r) => r.status === "delivered").length;

    // Previous 30d (30-60 days ago)
    const prevQ = await scoped(
      supabase
        .from("message_logs")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", data.brandId)
        .gte("sent_at", d60)
        .lt("sent_at", d30),
    );
    const sentPrev30d = prevQ.count ?? 0;

    const trendPct =
      sentPrev30d === 0
        ? sent30d > 0
          ? null // sem base de comparação
          : null
        : Math.round(((sent30d - sentPrev30d) / sentPrev30d) * 100);

    const deliveryRate = sent30d === 0 ? null : delivered30d / sent30d;

    // Failed last 7d + top channel
    const failedQ = await scoped(
      supabase
        .from("message_logs")
        .select("channel")
        .eq("brand_id", data.brandId)
        .eq("status", "failed")
        .gte("sent_at", d7),
    );

    const failedRows = failedQ.data ?? [];
    const failed7d = failedRows.length;
    const counts = new Map<string, number>();
    for (const r of failedRows) counts.set(r.channel, (counts.get(r.channel) ?? 0) + 1);
    let topFailedChannel: string | null = null;
    let maxN = 0;
    for (const [ch, n] of counts) {
      if (n > maxN) {
        maxN = n;
        topFailedChannel = CHANNEL_LABELS[ch] ?? ch;
      }
    }

    // Coverage: brands where the user is a member + has at least 1 messaging credential
    const memberships = await supabase
      .from("brand_members")
      .select("brand_id")
      .eq("user_id", userId);
    const brandIds = (memberships.data ?? []).map((m) => m.brand_id);
    const brandsTotal = brandIds.length;

    let brandsCovered = 0;
    if (brandsTotal > 0) {
      const creds = await supabase
        .from("brand_api_credentials")
        .select("brand_id, provider")
        .in("brand_id", brandIds)
        .in("provider", MESSAGING_TOOLS as unknown as string[]);
      const set = new Set((creds.data ?? []).map((r) => r.brand_id));
      brandsCovered = set.size;
    }

    return {
      sent30d,
      sentPrev30d,
      trendPct,
      delivered30d,
      deliveryRate,
      failed7d,
      topFailedChannel,
      brandsTotal,
      brandsCovered,
    };
  });
