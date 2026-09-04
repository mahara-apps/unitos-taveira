/**
 * Social Core — server-only facade.
 *
 * ÚNICO ponto autorizado a orquestrar operações sociais no Unitos. Nenhum
 * módulo (Integrações, Conteúdo, Calendário, Publicações, Analytics, Brain,
 * Automações, APIs internas) pode importar Meta Graph, providers concretos
 * ou o `SocialAnalyticsService` diretamente — todo tráfego passa por aqui.
 *
 * Fluxo:
 *   Workspace → Marca → Social Core → Provider → API Oficial
 *
 * Toda operação recebe (brandId + channel). A conta ativa da Marca no canal
 * é resolvida internamente. Capabilities são checadas antes de despachar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  DateRange,
  SocialAudience,
  SocialConnectStart,
  SocialDashboard,
  SocialPost,
  SocialProfile,
  SocialPublishInput,
  SocialPublishResult,
  SocialScheduleResult,
  SocialTokenInfo,
} from "@/lib/social/types";
import * as SAS from "@/lib/social-analytics/service.server";
import { SocialServiceError } from "@/lib/social-analytics/service.server";
import { getCapabilities, isCapable, type CapabilityKey, type SocialChannel } from "./capabilities";
import {
  listBrandChannels,
  resolveBrandChannelConnection,
  type BrandChannelRef,
} from "./resolver.server";

export { SocialServiceError };
export type { BrandChannelRef, SocialChannel };

function assertCapable(channel: SocialChannel, key: CapabilityKey) {
  if (!isCapable(channel, key)) {
    throw new SocialServiceError(
      "provider_not_implemented",
      `Capability "${key}" indisponível para ${channel} nesta versão`,
      400,
      { channel, capability: key },
    );
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function connect(opts: {
  brandId: string;
  channel: SocialChannel;
  userId: string;
  returnUrl?: string;
}): Promise<SocialConnectStart> {
  assertCapable(opts.channel, "connect");
  return SAS.connect({
    network: opts.channel,
    brandId: opts.brandId,
    userId: opts.userId,
    returnUrl: opts.returnUrl,
  });
}

export async function disconnect(
  supabase: SupabaseClient<Database>,
  ref: BrandChannelRef,
  userToken: string,
): Promise<{ revoked: boolean }> {
  assertCapable(ref.channel, "disconnect");
  const conn = await resolveBrandChannelConnection(supabase, ref, userToken);
  return SAS.disconnect(conn);
}

export async function refreshToken(
  supabase: SupabaseClient<Database>,
  ref: BrandChannelRef,
  userToken: string,
): Promise<SocialTokenInfo & { accessToken: string }> {
  assertCapable(ref.channel, "refreshToken");
  const conn = await resolveBrandChannelConnection(supabase, ref, userToken);
  return SAS.refreshToken(conn);
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

type PublishPayload = Omit<SocialPublishInput, "network"> & BrandChannelRef;

function placementCap(p: SocialPublishInput["placement"]): CapabilityKey {
  return p === "story" ? "publish.story" : p === "reel" ? "publish.reel" : "publish.feed";
}

export async function publish(
  supabase: SupabaseClient<Database>,
  opts: PublishPayload,
  userToken: string,
): Promise<SocialPublishResult> {
  assertCapable(opts.channel, placementCap(opts.placement));
  const conn = await resolveBrandChannelConnection(
    supabase,
    { brandId: opts.brandId, channel: opts.channel },
    userToken,
  );
  const { brandId: _b, channel: _c, ...publishOpts } = opts;
  return SAS.publish(conn, publishOpts);
}

export async function schedule(
  supabase: SupabaseClient<Database>,
  opts: PublishPayload & { scheduledAt: string },
  userToken: string,
): Promise<SocialScheduleResult> {
  assertCapable(opts.channel, "schedule");
  const conn = await resolveBrandChannelConnection(
    supabase,
    { brandId: opts.brandId, channel: opts.channel },
    userToken,
  );
  const { brandId: _b, channel: _c, ...scheduleOpts } = opts;
  return SAS.schedule(conn, scheduleOpts);
}

// ---------------------------------------------------------------------------
// Read (analytics / conteúdo)
// ---------------------------------------------------------------------------

export async function getDashboard(
  supabase: SupabaseClient<Database>,
  ref: BrandChannelRef & { range: DateRange; period?: string },
  userToken: string,
): Promise<SocialDashboard> {
  assertCapable(ref.channel, "analytics.dashboard");
  const conn = await resolveBrandChannelConnection(supabase, ref, userToken);
  return SAS.getDashboard(conn, {
    range: ref.range,
    period: ref.period ?? `${ref.range.since}_${ref.range.until}`,
  });
}

export async function getPosts(
  supabase: SupabaseClient<Database>,
  ref: BrandChannelRef & { limit?: number },
  userToken: string,
): Promise<SocialPost[]> {
  assertCapable(ref.channel, "analytics.posts");
  const conn = await resolveBrandChannelConnection(supabase, ref, userToken);
  return SAS.getPosts(conn, { limit: ref.limit });
}

export async function getPost(
  supabase: SupabaseClient<Database>,
  ref: BrandChannelRef & { postId: string },
  userToken: string,
): Promise<SocialPost> {
  assertCapable(ref.channel, "analytics.posts");
  const conn = await resolveBrandChannelConnection(supabase, ref, userToken);
  return SAS.getPost(conn, { postId: ref.postId });
}

export async function getTopPosts(
  supabase: SupabaseClient<Database>,
  ref: BrandChannelRef & { limit?: number; sortBy?: string },
  userToken: string,
): Promise<SocialPost[]> {
  assertCapable(ref.channel, "analytics.topPosts");
  const conn = await resolveBrandChannelConnection(supabase, ref, userToken);
  return SAS.getTopPosts(conn, { limit: ref.limit, sortBy: ref.sortBy });
}

export async function getAudience(
  supabase: SupabaseClient<Database>,
  ref: BrandChannelRef & { range: DateRange },
  userToken: string,
): Promise<SocialAudience> {
  assertCapable(ref.channel, "analytics.audience");
  const conn = await resolveBrandChannelConnection(supabase, ref, userToken);
  return SAS.getAudience(conn, { range: ref.range });
}

export async function getProfile(
  supabase: SupabaseClient<Database>,
  ref: BrandChannelRef,
  userToken: string,
): Promise<SocialProfile> {
  assertCapable(ref.channel, "analytics.profile");
  const conn = await resolveBrandChannelConnection(supabase, ref, userToken);
  return SAS.getProfile(conn, {});
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

export async function listChannels(supabase: SupabaseClient<Database>, brandId: string) {
  return listBrandChannels(supabase, brandId);
}

export function capabilities(channel: SocialChannel) {
  return getCapabilities(channel);
}

/**
 * Namespace de conveniência — permite `SocialCore.publish(...)` deixando
 * óbvio a qual camada a chamada pertence.
 */
export const SocialCore = {
  connect,
  disconnect,
  refreshToken,
  publish,
  schedule,
  getDashboard,
  getPosts,
  getPost,
  getTopPosts,
  getAudience,
  getProfile,
  listChannels,
  capabilities,
};
