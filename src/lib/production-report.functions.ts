import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadStageMap, effectiveStage } from "@/lib/post-stage.server";

export type ProductionOrigin = "pauta" | "direto";

export type ProductionRow = {
  id: string;
  title: string;
  channels: string[];
  format: string | null;
  stage: string;
  origin: ProductionOrigin;
  date: string | null;
  created_at: string;
};

export type ProductionReport = {
  rows: ProductionRow[];
  byChannel: Record<string, number>;
  publishedCount: number;
  totalCount: number;
};

export const listProductionReportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        from: z.string(),
        to: z.string(),
        channel: z.string().optional(),
        stage: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ProductionReport> => {
    let q = context.supabase
      .from("posts")
      .select(
        "id, title, channels, format, stage, stage_id, monthly_plan_topic_id, scheduled_at, published_at, created_at",
      )
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .is("deleted_at", null)
      .gte("created_at", data.from)
      .lte("created_at", data.to)
      .order("created_at", { ascending: false })
      .limit(500);

    if (data.stage) q = q.eq("stage", data.stage as never);
    if (data.channel) q = q.contains("channels", [data.channel] as never);

    const { data: rows, error } = await q;
    if (error) throw error;

    const list = (rows ?? []) as Array<{
      id: string;
      title: string;
      channels: string[] | null;
      format: string | null;
      stage: string;
      stage_id: string | null;
      monthly_plan_topic_id: string | null;
      scheduled_at: string | null;
      published_at: string | null;
      created_at: string;
    }>;

    // Estágio efetivo vem de `stage_id` (coluna real do pipeline).
    const stageMap = await loadStageMap(
      context.supabase,
      list.map((p) => p.stage_id),
    );

    const byChannel: Record<string, number> = {};
    let publishedCount = 0;
    const mapped: ProductionRow[] = list.map((p) => {
      const channels = p.channels ?? [];
      for (const c of channels) byChannel[c] = (byChannel[c] ?? 0) + 1;
      const stage = effectiveStage(p.stage_id, p.stage, stageMap);
      if (stage === "published" || !!p.published_at) publishedCount += 1;
      return {
        id: p.id,
        title: p.title,
        channels,
        format: p.format,
        stage,
        origin: p.monthly_plan_topic_id ? "pauta" : "direto",
        date: p.published_at ?? p.scheduled_at ?? null,
        created_at: p.created_at,
      };
    });

    return {
      rows: mapped,
      byChannel,
      publishedCount,
      totalCount: mapped.length,
    };
  });
