import type {
  ConnectOptions,
  DisconnectOptions,
  GetAudienceOptions,
  GetDashboardOptions,
  GetPostOptions,
  GetPostsOptions,
  GetProfileOptions,
  GetTopPostsOptions,
  PublishOptions,
  RefreshTokenOptions,
  ScheduleOptions,
  SocialConnectStart,
  SocialPublishResult,
  SocialScheduleResult,
  SocialTokenInfo,
  ProviderResult,
  SocialAudience,
  SocialDashboard,
  SocialNetwork,
  SocialPost,
  SocialProfile,
} from "./types";

/**
 * Runtime context handed to every SocialProvider call. Resolved upstream by
 * the registry from a `social_connections` row plus the decrypted access
 * token. Providers must never talk to Supabase directly.
 */
export type SocialProviderContext = {
  connectionId: string;
  brandId: string;
  /** Raw provider key stored in `social_connections.provider` (e.g. "meta"). */
  provider: string;
  /** Page ID / channel ID / handle owner depending on the network. */
  externalId: string;
  externalName: string | null;
  /** Meta: Instagram Business Account ID (when the page has one linked). */
  accountId: string | null;
  accountUsername: string | null;
  /** Decrypted access token — never expose to the client. */
  accessToken: string;
};

/**
 * High-level contract every social network provider must implement.
 *
 * Providers translate their native APIs into the canonical model declared in
 * `./types.ts` so the frontend never depends on any network-specific surface.
 * Every method returns a `ProviderResult` and MUST NOT throw for partial
 * failures — surface those through `warnings` on the returned payload.
 */
export interface SocialProvider {
  /** Networks this provider can serve (a Meta provider serves fb + ig). */
  readonly networks: readonly SocialNetwork[];
  /** Human-readable label surfaced to logs/UI. */
  readonly label: string;

  // ---------- Lifecycle (OAuth + token management) ----------
  /**
   * Starts an OAuth connect flow WITHOUT any connection context — the caller
   * is on the UI side and there is no `ctx` yet. Returns the authorize URL
   * the browser must be redirected to.
   */
  connect(opts: ConnectOptions): Promise<ProviderResult<SocialConnectStart>>;

  /**
   * Revokes provider-side permissions (best effort) and marks the row as
   * disconnected. The service layer is responsible for persistence — the
   * provider only performs the network call to the platform.
   */
  disconnect(
    ctx: SocialProviderContext,
    opts: DisconnectOptions,
  ): Promise<ProviderResult<{ revoked: boolean }>>;

  /**
   * Refreshes / re-issues the long-lived access token. Callers persist the
   * returned `expiresAt` on the connection row.
   */
  refreshToken(
    ctx: SocialProviderContext,
    opts: RefreshTokenOptions,
  ): Promise<ProviderResult<SocialTokenInfo & { accessToken: string }>>;

  // ---------- Read ----------

  getDashboard(
    ctx: SocialProviderContext,
    opts: GetDashboardOptions,
  ): Promise<ProviderResult<SocialDashboard>>;

  getPosts(
    ctx: SocialProviderContext,
    opts: GetPostsOptions,
  ): Promise<ProviderResult<SocialPost[]>>;

  getPost(ctx: SocialProviderContext, opts: GetPostOptions): Promise<ProviderResult<SocialPost>>;

  getTopPosts(
    ctx: SocialProviderContext,
    opts: GetTopPostsOptions,
  ): Promise<ProviderResult<SocialPost[]>>;

  getAudience(
    ctx: SocialProviderContext,
    opts: GetAudienceOptions,
  ): Promise<ProviderResult<SocialAudience>>;

  getProfile(
    ctx: SocialProviderContext,
    opts: GetProfileOptions,
  ): Promise<ProviderResult<SocialProfile>>;

  // ---------- Write (publishing) ----------

  publish(
    ctx: SocialProviderContext,
    opts: PublishOptions,
  ): Promise<ProviderResult<SocialPublishResult>>;

  schedule(
    ctx: SocialProviderContext,
    opts: ScheduleOptions,
  ): Promise<ProviderResult<SocialScheduleResult>>;
}
