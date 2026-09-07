import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublicPlanDecisionResult, PublicPlanResolve } from "@/lib/monthly-plan-client.types";

export type {
  PublicPlanDecisionResult,
  PublicPlanResolve,
  PublicPlanTopic,
  PublicTopicClientStatus,
} from "@/lib/monthly-plan-client.types";

/**
 * Link público da Pauta mensal (`/pauta/$planId?token=…`) — mantido como
 * convite/fallback compatível. O token é a credencial e é sempre validado
 * (existência, revogação, expiração) antes de qualquer leitura ou escrita.
 *
 * Regras de aprovação e escrita vivem em `monthly-plan-decision.server.ts`,
 * as mesmas usadas pelo portal autenticado — não há lógica duplicada aqui.
 */

async function requireToken(sb: SupabaseClient, token: string) {
  const { data, error } = await sb
    .from("monthly_plan_tokens")
    .select("id, monthly_plan_id, client_id, brand_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  if (error) throw new Error("token_lookup_failed");
  if (!data) throw new Error("invalid_token");
  const row = data as {
    id: string;
    monthly_plan_id: string;
    client_id: string;
    brand_id: string;
    expires_at: string | null;
    revoked_at: string | null;
  };
  if (row.revoked_at) throw new Error("token_revoked");
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new Error("token_expired");
  }
  return row;
}

const tokenIn = z.object({ token: z.string().min(8).max(80) });

export const resolveMonthlyPlanPublic = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenIn.parse(i))
  .handler(async ({ data }): Promise<PublicPlanResolve> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadPlanForClient } = await import("@/lib/monthly-plan-decision.server");
    const sb = supabaseAdmin as unknown as SupabaseClient;
    const session = await requireToken(sb, data.token);
    return loadPlanForClient(sb, session.monthly_plan_id, session.client_id);
  });

const decideIn = z.object({
  token: z.string().min(8).max(80),
  decision: z.enum(["approve", "reject", "changes", "per_item"]),
  feedback: z.string().trim().max(2000).optional().default(""),
  items: z
    .array(
      z.object({
        topicId: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "changes"]),
        comment: z.string().trim().max(1000).optional().default(""),
      }),
    )
    .max(200)
    .optional(),
});

export const decideMonthlyPlanPublic = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => decideIn.parse(i))
  .handler(async ({ data }): Promise<PublicPlanDecisionResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decidePlanAsClient } = await import("@/lib/monthly-plan-decision.server");
    const sb = supabaseAdmin as unknown as SupabaseClient;
    const session = await requireToken(sb, data.token);
    return decidePlanAsClient(sb, {
      planId: session.monthly_plan_id,
      clientId: session.client_id,
      brandId: session.brand_id,
      decision: data.decision,
      feedback: data.feedback,
      items: data.items,
    });
  });

/* ------------------------------------------------------------------ */
/* Links de referência enviados pelo cliente (Drive, Figma, etc.)      */
/* ------------------------------------------------------------------ */

export type PublicTopicLink = {
  id: string;
  topic_id: string;
  url: string;
  title: string | null;
  source: string;
  created_by_client: boolean;
  created_at: string;
};

/** Garante que o tópico pertence à pauta do token (anti-IDOR). */
async function requireTopicOfPlan(sb: SupabaseClient, planId: string, topicId: string) {
  const { data, error } = await sb
    .from("monthly_plan_topics")
    .select("id")
    .eq("id", topicId)
    .eq("monthly_plan_id", planId)
    .maybeSingle();
  if (error) throw new Error("token_lookup_failed");
  if (!data) throw new Error("invalid_topic");
}

export const listPlanLinksPublic = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenIn.parse(i))
  .handler(async ({ data }): Promise<PublicTopicLink[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as unknown as SupabaseClient;
    const session = await requireToken(sb, data.token);
    const { data: topics } = await sb
      .from("monthly_plan_topics")
      .select("id")
      .eq("monthly_plan_id", session.monthly_plan_id);
    const ids = (topics ?? []).map((t) => (t as { id: string }).id);
    if (ids.length === 0) return [];
    const { data: rows, error } = await sb
      .from("work_links")
      .select("id, topic_id, url, title, source, created_by_client, created_at")
      .in("topic_id", ids)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as unknown as PublicTopicLink[];
  });

export const addPlanLinkPublic = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    tokenIn
      .extend({
        topicId: z.string().uuid(),
        url: z.string().trim().min(4).max(2000),
        title: z.string().trim().max(160).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }): Promise<{ ok: true; id: string }> => {
    const { normalizeLinkUrl, detectLinkSource } = await import("@/lib/link-source");
    const url = normalizeLinkUrl(data.url);
    if (!url) throw new Error("invalid_url");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as unknown as SupabaseClient;
    const session = await requireToken(sb, data.token);
    await requireTopicOfPlan(sb, session.monthly_plan_id, data.topicId);

    const { count } = await sb
      .from("work_links")
      .select("id", { count: "exact", head: true })
      .eq("topic_id", data.topicId);
    if ((count ?? 0) >= 20) throw new Error("too_many_links");

    const { data: row, error } = await sb
      .from("work_links")
      .insert({
        brand_id: session.brand_id,
        client_id: session.client_id,
        topic_id: data.topicId,
        url,
        title: data.title?.trim() ? data.title.trim() : null,
        source: detectLinkSource(url),
        created_by: null,
        created_by_client: true,
      } as never)
      .select("id")
      .single();
    if (error) throw error;

    // Avisa a equipe (best-effort): link novo enviado pelo cliente.
    try {
      const { insertNotificationsDeduped, notificationDedupeKey } = await import(
        "@/lib/notifications-dedupe"
      );
      const { data: plan } = await sb
        .from("monthly_plans")
        .select("title, created_by")
        .eq("id", session.monthly_plan_id)
        .maybeSingle();
      const ownerId = (plan as { created_by?: string | null } | null)?.created_by ?? null;
      if (ownerId) {
        const linkId = (row as { id: string }).id;
        await insertNotificationsDeduped(sb as never, [
          {
            user_id: ownerId,
            brand_id: session.brand_id,
            kind: "system",
            title: "Cliente anexou um link na pauta",
            body: (plan as { title?: string | null } | null)?.title ?? null,
            href: `/content/plans/${session.monthly_plan_id}`,
            payload: { topic_id: data.topicId, url },
            dedupe_key: notificationDedupeKey("plan_client_link", linkId),
          },
        ]);
      }
    } catch (err) {
      console.error("[plan-public] falha ao notificar link do cliente", {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    return { ok: true, id: (row as { id: string }).id };
  });

export const deletePlanLinkPublic = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenIn.extend({ linkId: z.string().uuid() }).parse(i))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as unknown as SupabaseClient;
    const session = await requireToken(sb, data.token);
    // O cliente só remove o que ele mesmo enviou, dentro da própria pauta.
    const { data: link } = await sb
      .from("work_links")
      .select("id, topic_id, created_by_client")
      .eq("id", data.linkId)
      .maybeSingle();
    const row = link as { topic_id: string | null; created_by_client: boolean } | null;
    if (!row || !row.created_by_client || !row.topic_id) throw new Error("invalid_link");
    await requireTopicOfPlan(sb, session.monthly_plan_id, row.topic_id);
    const { error } = await sb.from("work_links").delete().eq("id", data.linkId);
    if (error) throw error;
    return { ok: true };
  });
