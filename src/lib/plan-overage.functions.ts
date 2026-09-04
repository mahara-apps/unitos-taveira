import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLAN_CHANNELS } from "@/lib/monthly-plan-fields";
import { assertBrandAdmin } from "@/lib/access-guard";
import { currentPeriodMonth } from "@/lib/plan-overage.server";
import {
  notifyOverageDecided,
  notifyOverageRequested,
} from "@/lib/plan-overage-notify.server";

export type OverageStatus = "pending" | "approved" | "rejected";

export type OverageRequestRow = {
  id: string;
  brand_id: string;
  client_id: string;
  client_name: string | null;
  channel: string;
  period_month: string;
  quota: number;
  requested: number;
  overage: number;
  justification: string | null;
  status: OverageStatus;
  requested_by: string | null;
  requester_name: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

/* ---------- Solicitar excedente ---------- */

export const requestPlanOverageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        justification: z.string().trim().max(1000).optional().default(""),
        items: z
          .array(
            z.object({
              channel: z.enum(PLAN_CHANNELS),
              quota: z.number().int().min(0),
              requested: z.number().int().min(1),
              overage: z.number().int().min(1),
            }),
          )
          .min(1),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const period = currentPeriodMonth();
    const rows = data.items.map((it) => ({
      brand_id: data.brandId,
      client_id: data.clientId,
      channel: it.channel,
      period_month: period,
      quota: it.quota,
      requested: it.requested,
      overage: it.overage,
      justification: data.justification || null,
      status: "pending",
      requested_by: context.userId,
    }));
    const { error } = await context.supabase
      .from("plan_overage_requests" as never)
      .insert(rows as never);
    if (error) throw error;

    // Aprovadores precisam ver o pedido no sino e em /notifications.
    try {
      const [{ data: client }, { data: profile }] = await Promise.all([
        context.supabase.from("clients").select("name").eq("id", data.clientId).maybeSingle(),
        context.supabase
          .from("user_profiles")
          .select("full_name")
          .eq("id", context.userId)
          .maybeSingle(),
      ]);
      await notifyOverageRequested(context.supabase, {
        brandId: data.brandId,
        clientId: data.clientId,
        clientName: (client as { name?: string | null } | null)?.name ?? null,
        requestedBy: context.userId,
        requesterName: (profile as { full_name?: string | null } | null)?.full_name ?? null,
        items: data.items,
        justification: data.justification || null,
        periodMonth: period,
      });
    } catch (err) {
      console.warn("[plan-overage] notify requested failed", err);
    }

    return { ok: true as const, count: rows.length };
  });

/* ---------- Listagem (gestor) ---------- */

export const listPlanOverageRequestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().optional(),
        status: z.enum(["pending", "approved", "rejected", "all"]).optional().default("all"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<OverageRequestRow[]> => {
    let q = context.supabase
      .from("plan_overage_requests" as never)
      .select("*")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    const list = (rows ?? []) as unknown as OverageRequestRow[];
    if (!list.length) return [];

    const clientIds = Array.from(new Set(list.map((r) => r.client_id)));
    const userIds = Array.from(
      new Set(list.map((r) => r.requested_by).filter((v): v is string => !!v)),
    );
    const [{ data: clients }, { data: profiles }] = await Promise.all([
      context.supabase.from("clients").select("id, name").in("id", clientIds),
      userIds.length
        ? context.supabase.from("user_profiles").select("user_id, full_name").in("user_id", userIds)
        : Promise.resolve({ data: [] as Array<{ user_id: string; full_name: string | null }> }),
    ]);
    const cMap = new Map(
      ((clients ?? []) as Array<{ id: string; name: string | null }>).map((c) => [c.id, c.name]),
    );
    const uMap = new Map(
      ((profiles ?? []) as Array<{ user_id: string; full_name: string | null }>).map((p) => [
        p.user_id,
        p.full_name,
      ]),
    );
    return list.map((r) => ({
      ...r,
      client_name: cMap.get(r.client_id) ?? null,
      requester_name: r.requested_by ? (uMap.get(r.requested_by) ?? null) : null,
    }));
  });

/* ---------- Decisão (autorizar / recusar) ---------- */

export const decidePlanOverageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approved", "rejected"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Decisão é ato administrativo: exige autoridade no workspace da solicitação.
    const { data: req, error: readErr } = await context.supabase
      .from("plan_overage_requests" as never)
      .select("id, brand_id, client_id, channel, quota, requested, overage, requested_by")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!req) throw new Error("overage_request_not_found");
    const row = req as unknown as {
      brand_id: string;
      client_id: string;
      channel: string;
      quota: number;
      requested: number;
      overage: number;
      requested_by: string | null;
    };
    await assertBrandAdmin(context.supabase, context.userId, row.brand_id);

    const { error } = await context.supabase
      .from("plan_overage_requests" as never)
      .update({
        status: data.decision,
        decided_by: context.userId,
        decided_at: new Date().toISOString(),
      } as never)
      .eq("id", data.id);
    if (error) throw error;

    try {
      const { data: client } = await context.supabase
        .from("clients")
        .select("name")
        .eq("id", row.client_id)
        .maybeSingle();
      await notifyOverageDecided(context.supabase, {
        requestId: data.id,
        brandId: row.brand_id,
        clientId: row.client_id,
        clientName: (client as { name?: string | null } | null)?.name ?? null,
        requestedBy: row.requested_by,
        decision: data.decision,
        item: {
          channel: row.channel,
          quota: row.quota,
          requested: row.requested,
          overage: row.overage,
        },
      });
    } catch (err) {
      console.warn("[plan-overage] notify decided failed", err);
    }

    return { ok: true as const };
  });

/* ---------- Política de volumetria (bloquear × livre) ---------- */

/**
 * Política efetiva do cliente + override próprio. Padrão do workspace vem de
 * `brands.overage_policy`; o cliente pode sobrescrever.
 */
export const getOveragePolicyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const [{ data: brand }, { data: client }] = await Promise.all([
      context.supabase.from("brands").select("overage_policy").eq("id", data.brandId).maybeSingle(),
      context.supabase
        .from("clients")
        .select("overage_policy")
        .eq("id", data.clientId)
        .maybeSingle(),
    ]);
    const brandPolicy =
      ((brand as { overage_policy?: string | null } | null)?.overage_policy as
        | "block"
        | "warn"
        | null) ?? "block";
    const clientPolicy =
      ((client as { overage_policy?: string | null } | null)?.overage_policy as
        | "block"
        | "warn"
        | null) ?? null;
    return {
      brandPolicy,
      clientPolicy,
      effective: clientPolicy ?? brandPolicy,
    };
  });

/** Ativa/desativa volumetria livre para o cliente (ato administrativo). */
export const setClientOveragePolicyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        policy: z.enum(["block", "warn"]).nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAdmin(context.supabase, context.userId, data.brandId);
    const { error } = await context.supabase
      .from("clients")
      .update({ overage_policy: data.policy } as never)
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId);
    if (error) throw error;
    return { ok: true as const, policy: data.policy };
  });
