// ⚠️ Brain Insight Engine — leitura/escrita de insights ativos.
//
// Isolamento por COLUNA (client_id + scope), não por metadata: o filtro antigo
// (`metadata->>client_id`) dependia de um campo opcional, então um insight
// gerado sem esse metadata aparecia para QUALQUER cliente da marca.
// Regra: com cliente ativo → global + marca + aquele cliente;
//        sem cliente ativo → global + marca (nunca insights client-scoped).
import type { BrainContext, BrainInsightRow } from "../core";
import { brainFail } from "../observability";

const SELECT =
  "id, insight_type, description, confidence, expires_at, scope, brand_id, client_id, created_at";

export interface CreateInsightInput {
  insight_type: string;
  description: string;
  confidence?: number;
  expires_at?: string | null;
  metadata?: Record<string, unknown>;
}

function scoped<T>(q: T, ctx: BrainContext): T {
  const query = q as unknown as {
    or: (f: string) => unknown;
    is: (c: string, v: null) => unknown;
  };
  let out: unknown = ctx.brandId
    ? query.or(`brand_id.eq.${ctx.brandId},brand_id.is.null`)
    : query.is("brand_id", null);
  const next = out as { or: (f: string) => unknown; is: (c: string, v: null) => unknown };
  out = ctx.clientId
    ? next.or(`client_id.eq.${ctx.clientId},client_id.is.null`)
    : next.is("client_id", null);
  return out as T;
}

export async function list(
  ctx: BrainContext,
  opts: { limit?: number } = {},
): Promise<BrainInsightRow[]> {
  const limit = opts.limit ?? 15;
  const q = ctx.supabase
    .from("brain_insights")
    .select(SELECT)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("confidence", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  const { data, error } = await scoped(q, ctx);
  if (error) brainFail("insights.list", error, ctx);
  return (data ?? []) as BrainInsightRow[];
}

export async function create(
  ctx: BrainContext,
  input: CreateInsightInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await ctx.supabase
    .from("brain_insights")
    .insert({
      brand_id: ctx.brandId ?? null,
      // O trigger brain_scope_guard resolve `scope` a partir de brand/client.
      client_id: ctx.clientId ?? null,
      insight_type: input.insight_type,
      description: input.description,
      confidence: input.confidence ?? 0.5,
      expires_at: input.expires_at ?? null,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[brain.insights.create]", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id?: string } | null)?.id };
}

export async function patterns(
  ctx: BrainContext,
  opts: { limit?: number } = {},
): Promise<BrainInsightRow[]> {
  const q = ctx.supabase
    .from("brain_insights")
    .select(SELECT)
    .ilike("insight_type", "%pattern%")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("confidence", { ascending: false })
    .limit(opts.limit ?? 10);
  const { data, error } = await scoped(q, ctx);
  if (error) brainFail("insights.patterns", error, ctx);
  return (data ?? []) as BrainInsightRow[];
}
