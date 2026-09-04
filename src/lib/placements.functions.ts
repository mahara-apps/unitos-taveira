import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PLACEMENT_FORMATS = ["feed", "stories", "reels", "carrossel"] as const;
export type PlacementFormat = (typeof PLACEMENT_FORMATS)[number];

// Business rule: which combos may coexist on the same card.
// Feed and Reels both occupy the main grid; Feed and Carrossel occupy the same slot.
const INVALID_PAIRS: Array<[PlacementFormat, PlacementFormat]> = [
  ["feed", "reels"],
  ["feed", "carrossel"],
  ["reels", "carrossel"],
];

export function validatePlacementSet(formats: PlacementFormat[]): string | null {
  const set = new Set(formats);
  for (const [a, b] of INVALID_PAIRS) {
    if (set.has(a) && set.has(b)) {
      return `Combinação inválida: ${a.toUpperCase()} + ${b.toUpperCase()} ocupam o mesmo espaço de publicação.`;
    }
  }
  return null;
}

export type Placement = {
  id: string;
  post_id: string;
  brand_id: string;
  client_id: string;
  format: PlacementFormat;
  scheduled_at: string | null;
  copy_override: {
    hook?: string;
    headline?: string;
    copy?: string;
    cta?: string;
    hashtags?: string;
  } | null;
  media: Array<{ path: string; type?: string; name?: string }>;
  status: "draft" | "scheduled" | "published" | "failed";
  published_at: string | null;
  is_primary: boolean;
  external_ref: string | null;
};

export const listPlacementsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<Placement[]> => {
    const { data: rows, error } = await context.supabase
      .from("post_placements")
      .select(
        "id,post_id,brand_id,client_id,format,scheduled_at,copy_override,media,status,published_at,is_primary,external_ref",
      )
      .eq("post_id", data.postId)
      .order("is_primary", { ascending: false })
      .order("scheduled_at", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as Placement[];
  });

/**
 * FASE 4 (C2) — Caminhos de escrita de placements REMOVIDOS.
 *
 * `savePlacementsFn` e `deletePlacementFn` eram o fluxo LEGADO: criavam
 * `post_placements` sem `connection_id`, ou seja, destino de publicação sem
 * canal real — incompatível com a arquitetura atual
 * (connection_id -> social_connections -> client_social_accounts -> mesmo
 * cliente/mesma brand, validada pelo trigger `trg_validate_placement_connection`).
 * Nenhum componente as importava (código morto).
 *
 * Caminho oficial ÚNICO de escrita: `syncPostPlacements` em
 * `@/lib/placements.server` (wizard de agendamento + Kanban editorial).
 * Este módulo mantém apenas tipos/validações e a leitura `listPlacementsFn`.
 */
