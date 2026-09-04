// ⚠️ Brain Memory Store — leitura e escrita de memórias consolidadas.
//
// Schema real (public.brain_memory): title / description / category / scope /
// client_id / brand_id / confidence / reinforcement_count / status.
// NÃO existem colunas `topic` nem `summary` — o código antigo lia esses nomes e
// o PostgREST devolvia erro, que era engolido: o Brain parecia "sem memória".
// Toda leitura aqui falha de forma OBSERVÁVEL (brainFail), nunca em silêncio.
//
// Isolamento (hierarquia GLOBAL → BRAND → CLIENT):
//  - com cliente ativo: global + marca + AQUELE cliente;
//  - sem cliente ativo: global + marca (nunca memórias de um cliente
//    específico, para não misturar clientes num contexto de marca).
import type { BrainContext, BrainMemoryRow } from "../core";
import { brainFail } from "../observability";
import { callRpc } from "@/lib/supabase-rpc";

const SELECT =
  "id, brand_id, client_id, scope, category, title, description, confidence, reinforcement_count, updated_at";

export interface RememberInput {
  title: string;
  description: string;
  category?: string;
  confidence?: number;
  source_module?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

type RawMemory = {
  id: string;
  brand_id: string | null;
  client_id: string | null;
  scope: string | null;
  category: string | null;
  title: string | null;
  description: string | null;
  confidence: number | null;
  reinforcement_count: number | null;
  updated_at: string | null;
};

function toRow(r: RawMemory): BrainMemoryRow {
  return {
    id: r.id,
    title: r.title ?? "(sem título)",
    description: r.description ?? "",
    category: r.category ?? "geral",
    scope: (r.scope as BrainMemoryRow["scope"]) ?? "global",
    confidence: r.confidence,
    reinforcement_count: r.reinforcement_count ?? 0,
    brand_id: r.brand_id,
    client_id: r.client_id,
    updated_at: r.updated_at,
  };
}

/** Aplica o recorte de escopo. Nunca retorna memória de outro cliente. */
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
  opts: { limit?: number; categories?: string[] } = {},
): Promise<BrainMemoryRow[]> {
  const limit = opts.limit ?? 15;
  let q = ctx.supabase
    .from("brain_memory")
    .select(SELECT)
    .eq("status", "active")
    .order("confidence", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (opts.categories?.length) q = q.in("category", opts.categories);
  const { data, error } = await scoped(q, ctx);
  if (error) brainFail("memory.list", error, ctx);
  return ((data ?? []) as RawMemory[]).map(toRow);
}

export async function remember(
  ctx: BrainContext,
  input: RememberInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  // Escreve pelo mesmo caminho da consolidação (RPC) para herdar versionamento,
  // reforço, escopo automático e trilha de auditoria.
  return evolve(ctx, {
    entityType: "note",
    entityId: crypto.randomUUID(),
    category: input.category ?? "manual_note",
    title: input.title,
    description: input.description,
    evidenceConfidence: input.confidence ?? 0.5,
    origin: "manual",
    tags: input.tags ?? [],
    metadata: { ...(input.metadata ?? {}), source_module: input.source_module ?? "brain.api" },
  });
}

export async function search(
  ctx: BrainContext,
  args: { text: string; limit?: number },
): Promise<BrainMemoryRow[]> {
  const term = args.text.replace(/[%,()]/g, " ").trim();
  if (!term) return [];
  const q = ctx.supabase
    .from("brain_memory")
    .select(SELECT)
    .eq("status", "active")
    .or(`title.ilike.%${term}%,description.ilike.%${term}%`)
    .order("confidence", { ascending: false })
    .limit(args.limit ?? 15);
  const { data, error } = await scoped(q, ctx);
  if (error) brainFail("memory.search", error, ctx);
  return ((data ?? []) as RawMemory[]).map(toRow);
}

// ---------- Lifecycle: evolve / touch / versions / decay ----------

export interface EvolveInput {
  entityType: string;
  entityId: string;
  category: string;
  title: string;
  description?: string | null;
  content?: Record<string, unknown>;
  evidenceConfidence?: number;
  origin?: "system" | "event" | "learning" | "consolidation" | "manual" | "api" | "chat";
  sourceEvent?: string | null;
  tags?: string[];
  relations?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  contradicts?: boolean;
}

export async function evolve(
  ctx: BrainContext,
  input: EvolveInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await callRpc(ctx.supabase, "brain_memory_evolve", {
    _brand_id: ctx.brandId ?? null,
    _entity_type: input.entityType,
    _entity_id: input.entityId,
    _category: input.category,
    _title: input.title,
    _description: input.description ?? null,
    _content: input.content ?? {},
    _evidence_confidence: input.evidenceConfidence ?? 0.6,
    _origin: input.origin ?? "system",
    _source_event: input.sourceEvent ?? null,
    _tags: input.tags ?? [],
    _relations: input.relations ?? [],
    // O client_id do escopo viaja no metadata; o trigger brain_scope_guard
    // resolve `scope` e `client_id` de forma determinística no banco.
    _metadata: { ...(input.metadata ?? {}), client_id: ctx.clientId ?? null },
    _contradicts: input.contradicts ?? false,
  });
  if (error) {
    console.error("[brain.memory.evolve]", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data ? String(data) : undefined };
}

export async function touch(ctx: BrainContext, ids: string[]): Promise<number> {
  if (!ids.length) return 0;

  const { data, error } = await callRpc(ctx.supabase, "brain_memory_touch", { _ids: ids });
  if (error) {
    console.error("[brain.memory.touch]", error.message);
    return 0;
  }
  return Number(data ?? 0);
}

export async function versions(
  ctx: BrainContext,
  memoryId: string,
  limit = 30,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await ctx.supabase
    .from("brain_memory_versions")
    .select(
      "id, memory_id, version, confidence, previous_confidence, delta_confidence, title, description, status, change_reason, source_event, created_at",
    )
    .eq("memory_id", memoryId)
    .order("version", { ascending: false })
    .limit(limit);
  if (error) brainFail("memory.versions", error, ctx);
  return (data ?? []) as Array<Record<string, unknown>>;
}

export async function decay(ctx: BrainContext): Promise<number> {
  const { data, error } = await callRpc(ctx.supabase, "brain_memory_decay_and_archive", {});
  if (error) {
    console.error("[brain.memory.decay]", error.message);
    return 0;
  }
  return Number(data ?? 0);
}
