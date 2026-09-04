// ⚠️ Brain API boundary — este arquivo faz parte da plataforma Brain.
// Consumidores externos NÃO devem importar deste módulo diretamente:
// use o namespace `brain` exportado em `src/lib/brain/api.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  brandId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  actorId: z.string().uuid().nullable().optional(),
  category: z.string().nullable().optional(),
  days: z.number().int().min(1).max(365).optional(),
});

export type BrainIntelligence = {
  kpis: {
    knowledge: number;
    memories: number;
    insights: number;
    recommendations: number;
    avgConfidence: number;
    patterns: number;
  };
  learnedToday: {
    events: number;
    memoriesUpdated: number;
    insightsCreated: number;
    recommendationsCreated: number;
    knowledgeReinforced: number;
  };
  recentKnowledge: Array<{
    id: string;
    category: string;
    key: string;
    confidence: number;
    updated_at: string;
    reinforcement_count: number;
  }>;
  topDiscoveries: Array<{
    id: string;
    insight_type: string;
    description: string;
    confidence: number;
    created_at: string;
  }>;
  smartestClients: Array<{
    client_id: string;
    name: string;
    knowledge_count: number;
    avg_confidence: number;
  }>;
  topProjects: Array<{
    project_id: string;
    name: string;
    events_count: number;
  }>;
  learningTimeline: Array<{
    day: string;
    events: number;
    insights: number;
  }>;
  knowledgeMap: Array<{
    category: string;
    count: number;
    avg_confidence: number;
  }>;
  moduleRanking: Array<{
    source_module: string;
    count: number;
  }>;
  categoriesAvailable: string[];
  clientsAvailable: Array<{ id: string; name: string }>;
  projectsAvailable: Array<{ id: string; name: string }>;
  teamAvailable: Array<{ id: string; name: string }>;
};

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export const brainIntelligenceFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<BrainIntelligence> => {
    const sb = context.supabase;
    const brandId = data.brandId ?? null;
    const clientId = data.clientId ?? null;
    const projectId = data.projectId ?? null;
    const actorId = data.actorId ?? null;
    const category = data.category ?? null;
    const days = data.days ?? 30;

    const sincePeriod = daysAgoIso(days);
    const sinceToday = new Date();
    sinceToday.setHours(0, 0, 0, 0);
    const sinceTodayIso = sinceToday.toISOString();

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const applyBrand = (q: any): any => (brandId ? q.eq("brand_id", brandId) : q);
    const applyClient = (q: any): any => (clientId ? q.eq("client_id", clientId) : q);
    const applyProject = (q: any): any => (projectId ? q.eq("project_id", projectId) : q);
    const applyActor = (q: any): any => (actorId ? q.eq("actor_id", actorId) : q);
    const applyCategory = (q: any): any => (category ? q.eq("memory_type", category) : q);
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // --- KPIs ---
    // Fonte única: brain_memory. "Knowledge" = memórias factuais.
    // "Memories" = total ativo. "Patterns" = buckets analíticos.
    const KNOWLEDGE_BUCKET = ["fact", "knowledge", "preference", "profile"];
    const knowledgeCountQ = applyCategory(
      applyBrand(
        sb
          .from("brain_memory")
          .select("id", { count: "exact", head: true })
          .eq("status", "active")
          .in("memory_type", KNOWLEDGE_BUCKET),
      ),
    );
    const memoriesCountQ = applyBrand(
      sb.from("brain_memory").select("id", { count: "exact", head: true }).eq("status", "active"),
    );
    const insightsCountQ = applyBrand(
      sb.from("brain_insights").select("id", { count: "exact", head: true }),
    );
    const recsCountQ = applyClient(
      applyBrand(sb.from("brain_recommendations").select("id", { count: "exact", head: true })),
    );

    const knowledgeConfQ = applyCategory(
      applyBrand(
        sb
          .from("brain_memory")
          .select("confidence")
          .eq("status", "active")
          .in("memory_type", KNOWLEDGE_BUCKET)
          .limit(1000),
      ),
    );

    // patterns = memories with category "pattern" or insight_type containing pattern
    const patternsQ = applyBrand(
      sb
        .from("brain_memory")
        .select("id", { count: "exact", head: true })
        .in("memory_type", ["pattern", "insight", "long_term"]),
    );

    const [knowledgeCount, memoriesCount, insightsCount, recsCount, knowledgeConf, patternsCount] =
      await Promise.all([
        knowledgeCountQ,
        memoriesCountQ,
        insightsCountQ,
        recsCountQ,
        knowledgeConfQ,
        patternsQ,
      ]);

    const confVals = (knowledgeConf.data ?? [])
      .map((r: { confidence: number | null }) => Number(r.confidence ?? 0))
      .filter((n: number) => !Number.isNaN(n));
    const avgConfidence = confVals.length
      ? confVals.reduce((a: number, b: number) => a + b, 0) / confVals.length
      : 0;

    // --- Learned today ---
    const eventsTodayQ = applyProject(
      applyClient(
        applyActor(
          applyBrand(
            sb
              .from("brain_events")
              .select("id", { count: "exact", head: true })
              .gte("created_at", sinceTodayIso),
          ),
        ),
      ),
    );
    const memoriesUpdatedQ = applyBrand(
      sb
        .from("brain_memory")
        .select("id", { count: "exact", head: true })
        .gte("updated_at", sinceTodayIso),
    );
    const insightsCreatedQ = applyBrand(
      sb
        .from("brain_insights")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sinceTodayIso),
    );
    const recsCreatedQ = applyClient(
      applyBrand(
        sb
          .from("brain_recommendations")
          .select("id", { count: "exact", head: true })
          .gte("created_at", sinceTodayIso),
      ),
    );
    const knowledgeReinforcedQ = applyCategory(
      applyBrand(
        sb
          .from("brain_memory")
          .select("id", { count: "exact", head: true })
          .in("memory_type", KNOWLEDGE_BUCKET)
          .gte("updated_at", sinceTodayIso),
      ),
    );

    const [eventsToday, memoriesUpdated, insightsCreated, recsCreated, knowledgeReinforced] =
      await Promise.all([
        eventsTodayQ,
        memoriesUpdatedQ,
        insightsCreatedQ,
        recsCreatedQ,
        knowledgeReinforcedQ,
      ]);

    const recentKnowledgeQ = applyCategory(
      applyBrand(
        sb
          .from("brain_memory")
          .select("id, memory_type, key, confidence, updated_at, reinforcement_count")
          .eq("status", "active")
          .in("memory_type", KNOWLEDGE_BUCKET)
          .order("updated_at", { ascending: false })
          .limit(12),
      ),
    );

    // --- Top discoveries (insights ordered by confidence * based_on_events) ---
    const topDiscoveriesQ = applyBrand(
      sb
        .from("brain_insights")
        .select("id, insight_type, description, confidence, created_at, expires_at")
        .gte("created_at", sincePeriod)
        .order("confidence", { ascending: false })
        .limit(8),
    );

    // --- Learning timeline (events per day, insights per day for last N days) ---
    const timelineEventsQ = applyProject(
      applyClient(
        applyActor(
          applyBrand(
            sb.from("brain_events").select("created_at").gte("created_at", sincePeriod).limit(5000),
          ),
        ),
      ),
    );
    const timelineInsightsQ = applyBrand(
      sb.from("brain_insights").select("created_at").gte("created_at", sincePeriod).limit(1000),
    );

    const knowledgeMapQ = applyBrand(
      sb.from("brain_memory").select("memory_type, confidence").eq("status", "active").limit(2000),
    );

    // --- Module ranking (events per source_module) ---
    const moduleQ = applyBrand(
      sb.from("brain_events").select("source_module").gte("created_at", sincePeriod).limit(5000),
    );

    const clientsKnowledgeQ = applyBrand(
      sb
        .from("brain_memory")
        .select("subject_id, confidence")
        .eq("subject_type", "client")
        .eq("status", "active")
        .not("subject_id", "is", null)
        .limit(2000),
    );

    // --- Top projects (events grouped by project_id) ---
    const projectsEventsQ = applyBrand(
      sb
        .from("brain_events")
        .select("project_id")
        .gte("created_at", sincePeriod)
        .not("project_id", "is", null)
        .limit(5000),
    );

    const [
      recentKnowledgeR,
      topDiscoveriesR,
      timelineEventsR,
      timelineInsightsR,
      knowledgeMapR,
      moduleR,
      clientsKnowledgeR,
      projectsEventsR,
    ] = await Promise.all([
      recentKnowledgeQ,
      topDiscoveriesQ,
      timelineEventsQ,
      timelineInsightsQ,
      knowledgeMapQ,
      moduleQ,
      clientsKnowledgeQ,
      projectsEventsQ,
    ]);

    const topDiscoveries = (topDiscoveriesR.data ?? [])
      .filter(
        (r: { expires_at: string | null }) => !r.expires_at || new Date(r.expires_at) > new Date(),
      )
      .slice(0, 6)
      .map(
        (r: {
          id: string;
          insight_type: string;
          description: string;
          confidence: number | null;
          created_at: string;
        }) => ({
          id: r.id,
          insight_type: r.insight_type,
          description: r.description,
          confidence: Number(r.confidence ?? 0),
          created_at: r.created_at,
        }),
      );

    // Bucket timeline by day
    const timelineMap = new Map<string, { events: number; insights: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      timelineMap.set(d.toISOString().slice(0, 10), { events: 0, insights: 0 });
    }
    for (const r of timelineEventsR.data ?? []) {
      const day = new Date(r.created_at as string).toISOString().slice(0, 10);
      const cur = timelineMap.get(day);
      if (cur) cur.events += 1;
    }
    for (const r of timelineInsightsR.data ?? []) {
      const day = new Date(r.created_at as string).toISOString().slice(0, 10);
      const cur = timelineMap.get(day);
      if (cur) cur.insights += 1;
    }
    const learningTimeline = Array.from(timelineMap.entries()).map(([day, v]) => ({ day, ...v }));

    // Knowledge map by category
    const catAgg = new Map<string, { count: number; sum: number }>();
    for (const r of knowledgeMapR.data ?? []) {
      const c = (r.memory_type as string) || "outros";
      const cur = catAgg.get(c) ?? { count: 0, sum: 0 };
      cur.count += 1;
      cur.sum += Number(r.confidence ?? 0);
      catAgg.set(c, cur);
    }
    const knowledgeMap = Array.from(catAgg.entries())
      .map(([category, v]) => ({
        category,
        count: v.count,
        avg_confidence: v.count ? v.sum / v.count : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Module ranking
    const modAgg = new Map<string, number>();
    for (const r of moduleR.data ?? []) {
      const m = (r.source_module as string) || "unknown";
      modAgg.set(m, (modAgg.get(m) ?? 0) + 1);
    }
    const moduleRanking = Array.from(modAgg.entries())
      .map(([source_module, count]) => ({ source_module, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Smartest clients
    const clientAgg = new Map<string, { count: number; sum: number }>();
    for (const r of clientsKnowledgeR.data ?? []) {
      const id = r.subject_id as string;
      const cur = clientAgg.get(id) ?? { count: 0, sum: 0 };
      cur.count += 1;
      cur.sum += Number(r.confidence ?? 0);
      clientAgg.set(id, cur);
    }
    const topClientIds = Array.from(clientAgg.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([id]) => id);
    const { data: clientRows } = topClientIds.length
      ? await sb.from("clients").select("id, name").in("id", topClientIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const clientNameMap = new Map(
      (clientRows ?? []).map((c: { id: string; name: string }) => [c.id, c.name]),
    );
    const smartestClients = topClientIds.map((id) => {
      const agg = clientAgg.get(id)!;
      return {
        client_id: id,
        name: (clientNameMap.get(id) as string) ?? "Cliente",
        knowledge_count: agg.count,
        avg_confidence: agg.count ? agg.sum / agg.count : 0,
      };
    });

    // Top projects
    const projAgg = new Map<string, number>();
    for (const r of projectsEventsR.data ?? []) {
      const id = r.project_id as string;
      projAgg.set(id, (projAgg.get(id) ?? 0) + 1);
    }
    const topProjectIds = Array.from(projAgg.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id]) => id);
    const { data: projectRows } = topProjectIds.length
      ? await sb.from("projects").select("id, name").in("id", topProjectIds)
      : { data: [] as Array<{ id: string; name: string }> };
    const projectNameMap = new Map(
      (projectRows ?? []).map((p: { id: string; name: string }) => [p.id, p.name]),
    );
    const topProjects = topProjectIds.map((id) => ({
      project_id: id,
      name: (projectNameMap.get(id) as string) ?? "Projeto",
      events_count: projAgg.get(id) ?? 0,
    }));

    // Filter option lists (scoped by brand)
    const [clientsAvailableR, projectsAvailableR, teamR, categoriesR] = await Promise.all([
      applyBrand(sb.from("clients").select("id, name").order("name").limit(200)),
      applyBrand(sb.from("projects").select("id, name").order("name").limit(200)),
      applyBrand(sb.from("brand_members").select("user_id").limit(200)),
      applyBrand(sb.from("brain_memory").select("memory_type").eq("status", "active").limit(1000)),
    ]);

    const teamUserIds = Array.from(
      new Set(((teamR.data ?? []) as Array<{ user_id: string }>).map((t) => t.user_id)),
    );
    const { data: teamProfiles } = teamUserIds.length
      ? await sb.from("user_profiles").select("id, full_name").in("id", teamUserIds)
      : { data: [] as Array<{ id: string; full_name: string }> };
    const teamAvailable = (
      (teamProfiles ?? []) as Array<{ id: string; full_name: string | null }>
    ).map((p) => ({
      id: p.id,
      name: p.full_name ?? "Usuário",
    }));

    const categoriesAvailable = Array.from(
      new Set(
        ((categoriesR.data ?? []) as Array<{ memory_type: string | null }>)
          .map((r) => r.memory_type)
          .filter((c): c is string => !!c),
      ),
    ).sort();

    return {
      kpis: {
        knowledge: knowledgeCount.count ?? 0,
        memories: memoriesCount.count ?? 0,
        insights: insightsCount.count ?? 0,
        recommendations: recsCount.count ?? 0,
        avgConfidence,
        patterns: patternsCount.count ?? 0,
      },
      learnedToday: {
        events: eventsToday.count ?? 0,
        memoriesUpdated: memoriesUpdated.count ?? 0,
        insightsCreated: insightsCreated.count ?? 0,
        recommendationsCreated: recsCreated.count ?? 0,
        knowledgeReinforced: knowledgeReinforced.count ?? 0,
      },
      recentKnowledge: (recentKnowledgeR.data ?? []).map(
        (r: {
          id: string;
          memory_type: string;
          key: string;
          confidence: number | null;
          updated_at: string;
          reinforcement_count: number | null;
        }) => ({
          id: r.id,
          category: r.memory_type,
          key: r.key,
          confidence: Number(r.confidence ?? 0),
          updated_at: r.updated_at,
          reinforcement_count: r.reinforcement_count ?? 0,
        }),
      ),
      topDiscoveries,
      smartestClients,
      topProjects,
      learningTimeline,
      knowledgeMap,
      moduleRanking,
      categoriesAvailable,
      clientsAvailable: (clientsAvailableR.data ?? []) as Array<{ id: string; name: string }>,
      projectsAvailable: (projectsAvailableR.data ?? []) as Array<{ id: string; name: string }>,
      teamAvailable,
    };
  });
