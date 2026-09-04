// ⚠️ Brain Widget — server function que alimenta o componente reutilizável
// <BrainWidget />. Consome EXCLUSIVAMENTE a Brain API (`brain.buildContext`
// + `brain.getRecommendations`). Nunca acessa tabelas `brain_*` direto.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { brain, type BrainContext } from "@/lib/brain/api";

const Input = z.object({
  topic: z.string().min(1).max(280),
  module: z.string().min(1).max(40),
  brandId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  maxItems: z.number().int().min(1).max(8).optional(),
});

export type BrainWidgetItem = {
  kind: "memory" | "insight" | "recommendation" | "semantic" | "stat";
  label: string;
  detail: string;
  score: number;
  confidence: number | null;
};

export type BrainWidgetPayload = {
  topic: string;
  module: string;
  headline: string;
  items: BrainWidgetItem[];
  candidateCount: number;
  hasData: boolean;
};

export const loadBrainWidget = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }): Promise<BrainWidgetPayload> => {
    const ctx: BrainContext = {
      supabase: context.supabase,
      userId: context.userId,
      brandId: data.brandId ?? null,
      clientId: data.clientId ?? null,
      projectId: data.projectId ?? null,
      module: data.module,
    };

    const pack = await brain.buildContext(ctx, {
      question: data.topic,
      module: data.module,
    });

    const max = data.maxItems ?? 4;
    const items: BrainWidgetItem[] = pack.items.slice(0, max).map((i) => ({
      kind: i.kind,
      label: i.label,
      detail: i.detail,
      score: i.score,
      confidence: i.confidence ?? null,
    }));

    const headline = deriveHeadline(pack.items, data.topic);

    return {
      topic: data.topic,
      module: data.module,
      headline,
      items,
      candidateCount: pack.candidateCount,
      hasData: items.length > 0,
    };
  });

function deriveHeadline(
  items: ReadonlyArray<{ kind: string; label: string; detail: string; score: number }>,
  fallback: string,
): string {
  const insight = items.find((i) => i.kind === "insight");
  if (insight) return insight.detail || insight.label;
  const rec = items.find((i) => i.kind === "recommendation");
  if (rec) return rec.label;
  const mem = items.find((i) => i.kind === "memory");
  if (mem) return mem.detail || mem.label;
  return `O Brain ainda está aprendendo sobre: ${fallback}.`;
}
