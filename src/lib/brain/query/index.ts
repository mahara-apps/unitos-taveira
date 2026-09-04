// ⚠️ Brain Query Engine — busca semântica, retrieval e contadores operacionais.
// Encapsula pgvector (`match_brain_events` RPC), embeddings e stats.
import type { BrainContext, SemanticMemoryHit, BrainStats } from "../core";
import { withCache } from "../cache";

/** Cria embedding com a chave de API da marca. Retorna null em falha. */
export async function embed(ctx: BrainContext, text: string): Promise<number[] | null> {
  if (!ctx.brandId) return null;
  const { embedText } = await import("../legacy/brain-embed.server");
  return embedText(ctx.supabase, ctx.brandId, text);
}

/** Busca semântica por proximidade de vetor no escopo da brand. */
export async function semantic(
  ctx: BrainContext,
  args: { query: string; matchCount?: number },
): Promise<SemanticMemoryHit[]> {
  if (!ctx.brandId || !args.query) return [];
  const vec = await embed(ctx, args.query);
  if (!vec) return [];
  const { data } = await ctx.supabase.rpc("match_brain_events", {
    _brand_id: ctx.brandId,
    _query: vec as unknown as string,
    // Se houver cliente ativo, pedimos mais candidatos porque vamos filtrar
    // por client_id abaixo (o RPC não conhece client_id).
    _match_count: (args.matchCount ?? 6) * (ctx.clientId ? 4 : 1),
  });
  const rows = (data ?? []) as Array<SemanticMemoryHit & { event_id?: string }>;
  let filtered = rows;
  if (ctx.clientId && rows.length) {
    const ids = rows.map((r) => r.event_id).filter((v): v is string => Boolean(v));
    if (ids.length) {
      const { data: scoped } = await ctx.supabase
        .from("brain_events")
        .select("id, client_id")
        .in("id", ids);
      const allow = new Set(
        ((scoped ?? []) as Array<{ id: string; client_id: string | null }>)
          .filter((e) => e.client_id === ctx.clientId || e.client_id === null)
          .map((e) => e.id),
      );
      filtered = rows.filter((r) => r.event_id && allow.has(r.event_id));
    }
  }
  return filtered.slice(0, args.matchCount ?? 6).map((r) => ({
    content_summary: r.content_summary,
    similarity: r.similarity,
    event_type: r.event_type,
  }));
}

/** Contadores operacionais leves — nunca faz dump de linhas. */
export async function stats(ctx: BrainContext): Promise<BrainStats> {
  const cacheKey = `brain:stats:${ctx.brandId ?? "global"}:${ctx.clientId ?? "-"}`;
  return withCache<BrainStats>(cacheKey, 60_000, async () => {
    const out: BrainStats = {};
    // Fast path via MV only faz sentido em escopo de brand inteira. Quando há
    // um client_id ativo precisamos de contadores estritos por cliente para
    // não vazar posts/tarefas/projetos de outros clientes da mesma marca.
    if (ctx.brandId && !ctx.clientId) {
      // Fast path: leitura O(1) da view materializada (refresh a cada 5min via pg_cron).
      const { data, error } = await ctx.supabase
        .from("brain_stats_mv")
        .select("posts, tasks, projects")
        .eq("brand_id", ctx.brandId)
        .maybeSingle();
      if (!error && data) {
        if (typeof data.posts === "number") out.posts = data.posts;
        if (typeof data.tasks === "number") out.tasks = data.tasks;
        if (typeof data.projects === "number") out.projects = data.projects;
        return out;
      }
      // Fallback (linha ainda não materializada): counts diretos.
    }
    const build = (table: "posts" | "tasks" | "projects") => {
      let q = ctx.supabase.from(table).select("*", { count: "exact", head: true });
      if (ctx.brandId) q = q.eq("brand_id", ctx.brandId);
      if (ctx.clientId) q = q.eq("client_id", ctx.clientId);
      return q;
    };
    const [posts, tasks, projects] = await Promise.all([
      build("posts"),
      build("tasks"),
      build("projects"),
    ]);
    if (typeof posts.count === "number") out.posts = posts.count;
    if (typeof tasks.count === "number") out.tasks = tasks.count;
    if (typeof projects.count === "number") out.projects = projects.count;
    return out;
  });
}
