import type { ProviderResult, SocialNetwork } from "../types";
import type {
  AccountAnalyticsOptions,
  PostAnalyticsOptions,
  RecentPostsOptions,
  SocialAnalyticsProvider,
} from "../provider";

/**
 * Placeholder provider that reports "not implemented yet" for every call.
 * Keeps the registry uniform so the frontend can list all future networks
 * without conditional branching. Replace with a real implementation later.
 */
export function makeNotImplementedProvider(
  network: SocialNetwork,
  label: string,
): SocialAnalyticsProvider {
  const err = <T>(): ProviderResult<T> => ({
    ok: false,
    code: "not_implemented",
    error: `Provider "${label}" ainda não está disponível.`,
  });
  return {
    networks: [network],
    label,
    fetchAccountAnalytics: async (_ctx, _opts: AccountAnalyticsOptions) => err(),
    fetchPostAnalytics: async (_ctx, _opts: PostAnalyticsOptions) => err(),
    listRecentPosts: async (_ctx, _opts: RecentPostsOptions) => err(),
  };
}
