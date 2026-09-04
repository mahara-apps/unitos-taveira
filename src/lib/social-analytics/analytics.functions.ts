import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AccountAnalytics, PostAnalytics, SocialNetwork } from "./types";
import { withSocialCache, socialCacheKey } from "./cache";

/**
 * Social Analytics — client-facing API.
 *
 * The frontend calls these functions with `{ connectionId, network, ... }`
 * and always receives the canonical model. It never learns anything about
 * the underlying network's API.
 */

const NETWORK = z.enum(["facebook", "instagram", "linkedin", "tiktok", "youtube", "x", "threads"]);

const RangeSchema = z
  .object({
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
  })
  .optional();

const AccountInput = z.object({
  brandId: z.string().uuid(),
  connectionId: z.string().uuid(),
  network: NETWORK,
  range: RangeSchema,
});

const PostInput = z.object({
  brandId: z.string().uuid(),
  connectionId: z.string().uuid(),
  network: NETWORK,
  externalPostId: z.string().min(1),
});

const RecentInput = z.object({
  brandId: z.string().uuid(),
  connectionId: z.string().uuid(),
  network: NETWORK,
  limit: z.number().int().min(1).max(25).optional(),
});

// ---------------------------------------------------------------------------
// listSupportedNetworks — safe for the frontend to render "coming soon" chips
// ---------------------------------------------------------------------------
export const listSupportedNetworks = createServerFn({ method: "GET" }).handler(async () => {
  const { listSocialProviders } = await import("./registry.server");
  return listSocialProviders();
});

// ---------------------------------------------------------------------------
// getAccountAnalytics
// ---------------------------------------------------------------------------
export const getAccountAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AccountInput.parse(i))
  .handler(async ({ data, context }): Promise<AccountAnalytics> => {
    const ctx = await loadProviderContext(context.supabase, data.brandId, data.connectionId);
    const { getSocialProvider } = await import("./registry.server");
    const range = normaliseRange(data.range);
    const provider = getSocialProvider(data.network);
    const key = socialCacheKey("account", `${context.userId}:${data.connectionId}`, {
      n: data.network,
      s: range.since,
      u: range.until,
    });
    return withSocialCache(key, async () => {
      const res = await provider.fetchAccountAnalytics(ctx, { network: data.network, range });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    });
  });

// ---------------------------------------------------------------------------
// getPostAnalytics
// ---------------------------------------------------------------------------
export const getPostAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PostInput.parse(i))
  .handler(async ({ data, context }): Promise<PostAnalytics> => {
    const ctx = await loadProviderContext(context.supabase, data.brandId, data.connectionId);
    const { getSocialProvider } = await import("./registry.server");
    const provider = getSocialProvider(data.network);
    const key = socialCacheKey("post", `${context.userId}:${data.connectionId}`, {
      n: data.network,
      p: data.externalPostId,
    });
    return withSocialCache(key, async () => {
      const res = await provider.fetchPostAnalytics(ctx, {
        network: data.network,
        externalPostId: data.externalPostId,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    });
  });

// ---------------------------------------------------------------------------
// listRecentPostAnalytics
// ---------------------------------------------------------------------------
export const listRecentPostAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RecentInput.parse(i))
  .handler(async ({ data, context }): Promise<PostAnalytics[]> => {
    const ctx = await loadProviderContext(context.supabase, data.brandId, data.connectionId);
    const { getSocialProvider } = await import("./registry.server");
    const provider = getSocialProvider(data.network);
    const key = socialCacheKey("recent", `${context.userId}:${data.connectionId}`, {
      n: data.network,
      l: data.limit ?? 25,
    });
    return withSocialCache(key, async () => {
      const res = await provider.listRecentPosts(ctx, {
        network: data.network,
        limit: data.limit,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    });
  });

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------
async function loadProviderContext(supabase: any, brandId: string, connectionId: string) {
  const { data, error } = await supabase
    .from("social_connections")
    .select(
      "id, brand_id, provider, external_id, external_name, account_id, account_username, access_token_ciphertext, status",
    )
    .eq("id", connectionId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Conexão não encontrada");
  if (!data.access_token_ciphertext) throw new Error("Conexão sem token — reconecte");

  const { decryptCredential } = await import("@/lib/credentials-crypto.server");
  const token = await decryptCredential(data.access_token_ciphertext);
  return {
    connectionId: data.id as string,
    brandId: data.brand_id as string,
    provider: data.provider as string,
    externalId: data.external_id as string,
    externalName: (data.external_name as string | null) ?? null,
    accountId: (data.account_id as string | null) ?? null,
    accountUsername: (data.account_username as string | null) ?? null,
    accessToken: token,
  };
}

function normaliseRange(range: { since?: string; until?: string } | undefined) {
  const until = range?.until ? new Date(range.until) : new Date();
  const since = range?.since
    ? new Date(range.since)
    : new Date(until.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { since: since.toISOString(), until: until.toISOString() };
}

export type { AccountAnalytics, PostAnalytics, SocialNetwork } from "./types";
