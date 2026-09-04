import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hasPlacementOptions,
  normalizePlacementOptions,
  type PlacementOptions,
} from "@/lib/placement-options";

/**
 * Shared helper — reconciliação de `post_placements` a partir de destinos
 * (conta + formato). Único caminho oficial de escrita de placements: usado pelo
 * wizard de agendamento e pelo Kanban editorial.
 *
 * Estratégia: apaga os placements não publicados do post e reinsere.
 * Unicidade real (Fase 4): `(post_id, connection_id, format)` — a mesma peça
 * pode ter IG Feed + FB Feed. Destinos idênticos (mesmo canal + mesmo formato)
 * são deduplicados de forma DETERMINÍSTICA: vence a PRIMEIRA ocorrência.
 */

export type PlacementFormatEnum = "feed" | "stories" | "reels" | "carrossel";

export type PlacementDestination = {
  connectionId: string;
  channel: string;
  format: PlacementFormatEnum;
  copyOverride?: string | null;
  /** Opções avançadas do destino (cru — normalizado aqui). */
  options?: unknown;
};

export type SyncPostPlacementsInput = {
  postId: string;
  brandId: string;
  clientId: string;
  destinations: PlacementDestination[];
  mediaPaths?: string[];
  hashtags?: string[];
  firstComment?: string | null;
  linkUrl?: string | null;
  locationName?: string | null;
  locationId?: string | null;
  scheduledIso?: string | null;
  status?: "draft" | "scheduled";
};

export async function syncPostPlacements(
  supabase: SupabaseClient,
  input: SyncPostPlacementsInput,
): Promise<void> {
  const {
    postId,
    brandId,
    clientId,
    destinations,
    mediaPaths = [],
    hashtags = [],
    firstComment = null,
    linkUrl = null,
    locationName = null,
    locationId = null,
    scheduledIso = null,
    status = "draft",
  } = input;

  // Placements JÁ PUBLICADOS são histórico: nunca apagados nem reescritos.
  // A identidade do histórico é o DESTINO REAL: connection_id + format.
  const { data: publishedRows, error: pubErr } = await supabase
    .from("post_placements")
    .select("format, connection_id")
    .eq("post_id", postId)
    .eq("status", "published");
  if (pubErr) throw new Error(pubErr.message);
  const publishedKeys = new Set(
    ((publishedRows ?? []) as Array<{ format: string; connection_id: string | null }>).map(
      (r) => `${r.connection_id ?? "none"}::${r.format}`,
    ),
  );

  const { error: delErr } = await supabase
    .from("post_placements")
    .delete()
    .eq("post_id", postId)
    .neq("status", "published");
  if (delErr) throw new Error(delErr.message);

  if (!destinations.length) return;

  const mediaJson = mediaPaths.map((p) => ({ storagePath: p }));
  // UNIQUE(post_id, connection_id, format) — deduplicação determinística:
  // a PRIMEIRA ocorrência de cada destino vence; repetições são ignoradas.
  const byDestination = new Map<string, PlacementDestination>();
  for (const d of destinations) {
    const key = `${d.connectionId}::${d.format}`;
    if (publishedKeys.has(key)) continue;
    if (byDestination.has(key)) continue;
    byDestination.set(key, d);
  }

  const rows = Array.from(byDestination.values()).map((d, i) => {
    const options: PlacementOptions = normalizePlacementOptions(
      d.channel as never,
      d.format,
      d.options,
    );
    return {
    post_id: postId,
    brand_id: brandId,
    client_id: clientId,
    format: d.format,
    // Coluna canônica (Fase 1): FK real para social_connections.
    connection_id: d.connectionId,
    scheduled_at: scheduledIso,
    copy_override: {
      // Espelho legado — leitores antigos continuam funcionando.
      connection_id: d.connectionId,
      channel: d.channel,
      ...(d.copyOverride ? { copy: d.copyOverride } : {}),
      ...(hashtags.length ? { hashtags } : {}),
      ...(firstComment ? { first_comment: firstComment } : {}),
      ...(linkUrl ? { link: linkUrl } : {}),
      ...(locationName ? { location_name: locationName } : {}),
      ...(locationId ? { location_id: locationId } : {}),
      ...(hasPlacementOptions(options) ? { options } : {}),
    },
    media: mediaJson,
    status,
    is_primary: i === 0,
    };
  });

  if (!rows.length) return;
  const { error: insErr } = await supabase.from("post_placements").insert(rows);
  if (insErr) throw new Error(insErr.message);
}

/**
 * Enum de canais aceitos por `posts.channels` (post_channel).
 * Facebook não faz parte do enum — Facebook Feed é modelado apenas via
 * `post_placements.copy_override.channel` + `social_connections`.
 */
export const POST_CHANNEL_ENUM = new Set([
  "instagram",
  "tiktok",
  "linkedin",
  "x",
  "youtube",
  "blog",
]);

export type PostChannelEnum = "instagram" | "tiktok" | "linkedin" | "x" | "youtube" | "blog";

export function deriveChannelsFromDestinations(
  destinations: Array<{ channel: string }>,
): PostChannelEnum[] {
  return Array.from(new Set(destinations.map((d) => d.channel))).filter((c) =>
    POST_CHANNEL_ENUM.has(c),
  ) as PostChannelEnum[];
}

export function deriveTargetConnectionIds(destinations: Array<{ connectionId: string }>): string[] {
  return Array.from(new Set(destinations.map((d) => d.connectionId)));
}
