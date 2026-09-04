import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BrandMediaPlanRow = {
  id: string;
  title: string;
  status: "draft" | "approved" | "archived";
  monthly_budget: number;
  period_start: string | null;
  period_end: string | null;
  updated_at: string;
  created_at: string;
  client_id: string;
  client_name: string;
  items_count: number;
  allocated_pct: number;
  allocated_amount: number;
  share_token: string | null;
};

export const listBrandMediaPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("media_plans")
      .select(
        "id,title,status,monthly_budget,period_start,period_end,updated_at,created_at,client_id,share_token",
      )
      .eq("brand_id", data.brandId);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: plans, error } = await q.order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = plans ?? [];
    if (rows.length === 0) return { plans: [] as BrandMediaPlanRow[] };

    const planIds = rows.map((p) => p.id as string);
    const clientIds = Array.from(new Set(rows.map((p) => p.client_id as string)));

    const [{ data: clients }, { data: items }] = await Promise.all([
      context.supabase.from("clients").select("id,name").in("id", clientIds),
      context.supabase
        .from("media_plan_items")
        .select("plan_id,budget_pct,budget_amount")
        .in("plan_id", planIds),
    ]);
    const clientMap = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
    const agg = new Map<string, { count: number; pct: number; amount: number }>();
    for (const it of items ?? []) {
      const key = it.plan_id as string;
      const cur = agg.get(key) ?? { count: 0, pct: 0, amount: 0 };
      cur.count += 1;
      cur.pct += Number(it.budget_pct ?? 0);
      cur.amount += Number(it.budget_amount ?? 0);
      agg.set(key, cur);
    }

    const result: BrandMediaPlanRow[] = rows.map((p) => {
      const a = agg.get(p.id as string) ?? { count: 0, pct: 0, amount: 0 };
      return {
        id: p.id as string,
        title: (p.title as string) ?? "Plano de mídia",
        status: (p.status as "draft" | "approved" | "archived") ?? "draft",
        monthly_budget: Number(p.monthly_budget ?? 0),
        period_start: (p.period_start as string | null) ?? null,
        period_end: (p.period_end as string | null) ?? null,
        updated_at: p.updated_at as string,
        created_at: p.created_at as string,
        client_id: p.client_id as string,
        client_name: clientMap.get(p.client_id as string) ?? "Cliente",
        items_count: a.count,
        allocated_pct: a.pct,
        allocated_amount: a.amount,
        share_token: (p.share_token as string | null) ?? null,
      };
    });
    return { plans: result };
  });
