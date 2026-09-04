/**
 * Social Core — Brand-first connection resolver.
 *
 * Regra V1: cada Marca possui, no máximo, uma conta ATIVA por canal.
 * Todas as operações do Social Core partem de (brandId + channel) e este
 * resolver descobre a `social_connections` row correspondente, decripta o
 * token e devolve o `ResolvedConnection` que a camada de serviço já
 * consome. Nenhuma tela seleciona connectionId manualmente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  resolveConnection,
  SocialServiceError,
  type ResolvedConnection,
} from "@/lib/social-analytics/service.server";
import type { SocialChannel } from "./capabilities";

export type BrandChannelRef = {
  brandId: string;
  channel: SocialChannel;
  /**
   * Quando o post pertence a um cliente específico, resolvemos o canal
   * VINCULADO àquele cliente em `client_social_accounts` (única fonte de
   * verdade). Sem `clientId`, qualquer canal ativo da marca serve.
   * O campo legado `social_connections.client_id` nunca é consultado.
   */
  clientId?: string | null;
};

/**
 * Encontra a `social_connections.id` ativa para (brand, channel) e delega
 * ao resolver existente para montar `ResolvedConnection`. RLS aplica.
 */
export async function resolveBrandChannelConnection(
  supabase: SupabaseClient<Database>,
  ref: BrandChannelRef,
  userTokenForCache: string,
): Promise<ResolvedConnection> {
  let allowedIds: string[] | null = null;
  if (ref.clientId) {
    const { data: links, error: lErr } = await supabase
      .from("client_social_accounts")
      .select("connection_id")
      .eq("brand_id", ref.brandId)
      .eq("client_id", ref.clientId);
    if (lErr) throw new SocialServiceError("db_error", lErr.message, 500);
    allowedIds = (links ?? []).map((l) => l.connection_id);
    if (!allowedIds.length) {
      throw new SocialServiceError(
        "not_found",
        `Nenhum canal ${ref.channel} vinculado a este cliente. Vincule em Perfil do cliente > Canais.`,
        404,
        { brandId: ref.brandId, channel: ref.channel, clientId: ref.clientId },
      );
    }
  }

  let q = supabase
    .from("social_connections")
    .select("id, status")
    .eq("brand_id", ref.brandId)
    .eq("channel", ref.channel)
    .in("status", ["active", "attention"]);
  if (allowedIds) q = q.in("id", allowedIds);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (error) throw new SocialServiceError("db_error", error.message, 500);
  if (!data) {
    throw new SocialServiceError(
      "not_found",
      `Nenhuma conta ${ref.channel} conectada para esta marca. Conecte em /connections.`,
      404,
      { brandId: ref.brandId, channel: ref.channel },
    );
  }

  return resolveConnection(supabase, data.id, userTokenForCache);
}

/** Lista todos os canais ativos de uma Marca (leitura, sem decripta token). */
export async function listBrandChannels(
  supabase: SupabaseClient<Database>,
  brandId: string,
): Promise<
  Array<{
    connectionId: string;
    channel: SocialChannel;
    provider: string;
    label: string;
    handle: string | null;
    status: string;
  }>
> {
  const { data, error } = await supabase
    .from("social_connections")
    .select("id, channel, provider, external_name, account_username, status")
    .eq("brand_id", brandId)
    .in("status", ["active", "attention"])
    .order("created_at", { ascending: false });
  if (error) throw new SocialServiceError("db_error", error.message, 500);

  return (data ?? []).map((r) => ({
    connectionId: r.id,
    channel: r.channel as SocialChannel,
    provider: r.provider,
    label: r.account_username ? `@${r.account_username}` : (r.external_name ?? r.provider),
    handle: r.account_username ?? null,
    status: r.status,
  }));
}
