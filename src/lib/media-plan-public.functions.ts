import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type MediaPlanPublicPlan = {
  id: string;
  title: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  monthly_budget: number;
  updated_at: string;
};
type MediaPlanPublicClient = { id: string; name: string };
type MediaPlanPublicBrand = { id: string; name: string };
export type MediaPlanPublicResolve = {
  plan: MediaPlanPublicPlan;
  client: MediaPlanPublicClient;
  brand: MediaPlanPublicBrand;
};
export type MediaPlanPublicItem = {
  id: string;
  position: number;
  product_service: string | null;
  campaign_type: string | null;
  funnel_stage: "topo" | "meio" | "fundo" | null;
  objective: string | null;
  main_kpi: string | null;
  channel: string | null;
  audience: string | null;
  budget_pct: number;
  budget_amount: number;
  keywords: string[];
  benchmark: string | null;
  other_refs: string | null;
};

function getPublic(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("supabase_env_missing");
  const isOpaque = key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (isOpaque && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

const tokenIn = z.object({ token: z.string().min(8) });

export const resolveMediaPlanPublic = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenIn.parse(i))
  .handler(async ({ data }): Promise<MediaPlanPublicResolve> => {
    const c = getPublic();
    const { data: res, error } = await c.rpc("media_plan_public_resolve", {
      _token: data.token,
    });
    if (error) throw new Error(error.message);
    return res as MediaPlanPublicResolve;
  });

export const listMediaPlanPublicItems = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenIn.parse(i))
  .handler(async ({ data }): Promise<MediaPlanPublicItem[]> => {
    const c = getPublic();
    const { data: res, error } = await c.rpc("media_plan_public_items", {
      _token: data.token,
    });
    if (error) throw new Error(error.message);
    return (res ?? []) as MediaPlanPublicItem[];
  });
