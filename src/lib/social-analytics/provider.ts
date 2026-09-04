import type {
  AccountAnalytics,
  DateRange,
  PostAnalytics,
  ProviderResult,
  SocialNetwork,
} from "./types";

/**
 * Runtime context handed to every provider call. It carries the resolved
 * connection row (already loaded and authorized upstream) plus the decrypted
 * access token. Providers must never talk to Supabase directly.
 */
export type ProviderContext = {
  connectionId: string;
  brandId: string;
  /** Raw provider key stored in `social_connections.provider` (e.g. "meta"). */
  provider: string;
  /** Page ID / channel ID / handle owner ID depending on the network. */
  externalId: string;
  externalName: string | null;
  /** For Meta this is the Instagram Business Account ID (when present). */
  accountId: string | null;
  accountUsername: string | null;
  /** Decrypted access token — never expose to the client. */
  accessToken: string;
};

export type AccountAnalyticsOptions = {
  network: SocialNetwork;
  range: DateRange;
};

export type PostAnalyticsOptions = {
  network: SocialNetwork;
  externalPostId: string;
};

export type RecentPostsOptions = {
  network: SocialNetwork;
  limit?: number;
};

/**
 * Contract every social provider must implement. Providers translate their
 * native APIs into the canonical model in `./types.ts`.
 */
export interface SocialAnalyticsProvider {
  /** Networks this provider can serve (a Meta provider serves fb + ig). */
  readonly networks: readonly SocialNetwork[];
  /** Human-readable label surfaced to logs/UI. */
  readonly label: string;

  fetchAccountAnalytics(
    ctx: ProviderContext,
    opts: AccountAnalyticsOptions,
  ): Promise<ProviderResult<AccountAnalytics>>;

  fetchPostAnalytics(
    ctx: ProviderContext,
    opts: PostAnalyticsOptions,
  ): Promise<ProviderResult<PostAnalytics>>;

  listRecentPosts(
    ctx: ProviderContext,
    opts: RecentPostsOptions,
  ): Promise<ProviderResult<PostAnalytics[]>>;
}
