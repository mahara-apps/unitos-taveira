// ⚠️ Brain Knowledge Graph — leitura de nós/arestas do grafo relacional.
import type { BrainContext } from "../core";

export interface RelateInput {
  source_type: string;
  source_id: string;
  target_type: string;
  target_id: string;
  relationship_type: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export async function edges(
  ctx: BrainContext,
  opts: { limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const q = ctx.supabase
    .from("brain_relationships")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 200);
  const { data } = ctx.brandId ? await q.eq("brand_id", ctx.brandId) : await q;
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function relate(
  ctx: BrainContext,
  input: RelateInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await ctx.supabase
    .from("brain_relationships")
    .insert({
      brand_id: ctx.brandId ?? null,
      source_type: input.source_type,
      source_id: input.source_id,
      target_type: input.target_type,
      target_id: input.target_id,
      relationship_type: input.relationship_type,
      weight: input.weight ?? 1,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[brain.graph.relate]", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id?: string } | null)?.id };
}
