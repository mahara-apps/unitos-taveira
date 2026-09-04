import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/* -------------------- Public (unauthenticated) ------------------- */

export type PublicBriefingInfo = {
  ok: true;
  clientName: string;
  brandName: string;
  alreadySubmitted: boolean;
};

export type PublicBriefingError = {
  ok: false;
  reason: "not_found" | "revoked" | "expired";
};

export const getPublicBriefing = createServerFn({ method: "GET" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(10).max(200) }).parse(i))
  .handler(async ({ data }): Promise<PublicBriefingInfo | PublicBriefingError> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("client_briefing_tokens" as never)
      .select(
        "id, revoked_at, expires_at, submitted_at, client_id, brand_id, clients(name), brands(name)",
      )
      .eq("token", data.token)
      .maybeSingle();
    if (!row) return { ok: false, reason: "not_found" };
    const r = row as unknown as {
      revoked_at: string | null;
      expires_at: string | null;
      submitted_at: string | null;
      clients: { name: string } | null;
      brands: { name: string } | null;
    };
    if (r.revoked_at) return { ok: false, reason: "revoked" };
    if (r.expires_at && new Date(r.expires_at).getTime() < Date.now())
      return { ok: false, reason: "expired" };
    return {
      ok: true,
      clientName: r.clients?.name ?? "your brand",
      brandName: r.brands?.name ?? "the agency",
      alreadySubmitted: !!r.submitted_at,
    };
  });

const SubmissionSchema = z.object({
  token: z.string().min(10).max(200),
  description: z.string().trim().min(20).max(5000),
  audience: z.string().trim().min(10).max(2000),
  pain_points: z.string().trim().max(2000).optional().default(""),
  tone_tags: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
});

export const submitPublicBriefing = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => SubmissionSchema.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("client_briefing_tokens" as never)
      .select("id, brand_id, client_id, revoked_at, expires_at, submitted_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) throw new Error("token_not_found");
    const r = row as unknown as {
      id: string;
      brand_id: string;
      client_id: string;
      revoked_at: string | null;
      expires_at: string | null;
      submitted_at: string | null;
    };
    if (r.revoked_at) throw new Error("token_revoked");
    if (r.expires_at && new Date(r.expires_at).getTime() < Date.now())
      throw new Error("token_expired");

    const patch = {
      description: data.description,
      audience: data.audience,
      pain_points: data.pain_points || undefined,
      tone_tags: data.tone_tags,
    };

    const { data: current } = await supabaseAdmin
      .from("clients")
      .select("brand_hub, name")
      .eq("id", r.client_id)
      .maybeSingle();
    const prev = ((current as { brand_hub?: Record<string, unknown> } | null)?.brand_hub ??
      {}) as Record<string, unknown>;
    await supabaseAdmin
      .from("clients")
      .update({ brand_hub: { ...prev, ...patch } } as never)
      .eq("id", r.client_id);

    await supabaseAdmin
      .from("client_briefing_tokens" as never)
      .update({
        submitted_at: new Date().toISOString(),
        submission: patch,
      } as never)
      .eq("id", r.id);

    // Notify all brand members
    const { data: members } = await supabaseAdmin
      .from("brand_members")
      .select("user_id")
      .eq("brand_id", r.brand_id);
    const clientName = (current as { name?: string } | null)?.name ?? "cliente";
    const rows = (members ?? []).map((m: { user_id: string }) => ({
      brand_id: r.brand_id,
      user_id: m.user_id,
      kind: "briefing_submitted",
      title: `Briefing recebido: ${clientName}`,
      body: `${clientName} enviou o briefing público. Revise no Brand Intelligence Hub.`,
      href: `/customers/${r.client_id}`,
      payload: { client_id: r.client_id, token_id: r.id },
    }));
    if (rows.length) await supabaseAdmin.from("notifications").insert(rows as never);

    return { ok: true };
  });
