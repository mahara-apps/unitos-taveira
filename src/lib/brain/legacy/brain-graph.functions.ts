// ⚠️ Brain API boundary — este arquivo faz parte da plataforma Brain.
// Consumidores externos NÃO devem importar deste módulo diretamente:
// use o namespace `brain` exportado em `src/lib/brain/api.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GraphNode = {
  type: string;
  id: string;
  label: string;
};

export type GraphEdge = {
  id: string;
  from: { type: string; id: string };
  to: { type: string; id: string };
  type: string;
  strength: number;
  confidence: number;
  observations: number;
};

export type BrainGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { nodeCount: number; edgeCount: number; typeCounts: Record<string, number> };
};

const GraphInput = z.object({
  brandId: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(10).max(2000).optional(),
});

type RawNode = { type: string; id: string };
type RawEdge = GraphEdge;
type RawGraph = { nodes: RawNode[]; edges: RawEdge[] };

const LABEL_TABLES: Record<string, { table: string; column: string }> = {
  client: { table: "clients", column: "name" },
  project: { table: "projects", column: "name" },
  post: { table: "posts", column: "title" },
  task: { table: "tasks", column: "title" },
  user: { table: "user_profiles", column: "full_name" },
  brand: { table: "brands", column: "name" },
  document: { table: "client_documents", column: "name" },
  comment: { table: "task_comments", column: "id" },
  approval: { table: "post_approvals", column: "id" },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveLabels(sb: any, nodes: RawNode[]): Promise<Map<string, string>> {
  const byType = new Map<string, string[]>();
  for (const n of nodes) {
    if (!byType.has(n.type)) byType.set(n.type, []);
    byType.get(n.type)!.push(n.id);
  }
  const labels = new Map<string, string>();
  await Promise.all(
    [...byType.entries()].map(async ([type, ids]) => {
      const cfg = LABEL_TABLES[type];
      if (!cfg) return;
      const { data } = await sb.from(cfg.table).select(`id, ${cfg.column}`).in("id", ids);
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const id = String(row.id);
        const val = row[cfg.column];
        labels.set(`${type}:${id}`, typeof val === "string" && val.trim() ? val : id.slice(0, 8));
      }
    }),
  );
  return labels;
}

export const brainGraphFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GraphInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<BrainGraph> => {
    const sb = context.supabase;
    const { data: raw, error } = await sb.rpc("get_brain_graph", {
      _brand_id: data.brandId ?? undefined,
      _limit: data.limit ?? 300,
    });
    if (error) throw new Error(error.message);
    const graph = (raw ?? { nodes: [], edges: [] }) as RawGraph;
    const labels = await resolveLabels(sb, graph.nodes);
    const typeCounts: Record<string, number> = {};
    for (const n of graph.nodes) typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
    return {
      nodes: graph.nodes.map((n) => ({
        ...n,
        label: labels.get(`${n.type}:${n.id}`) ?? `${n.type}·${n.id.slice(0, 6)}`,
      })),
      edges: graph.edges ?? [],
      stats: { nodeCount: graph.nodes.length, edgeCount: (graph.edges ?? []).length, typeCounts },
    };
  });
