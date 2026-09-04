/**
 * Metric Mapping Registry.
 *
 * Each social network exposes different native metric names for the same
 * business concept (e.g. Instagram `followers_count`, Facebook `page_followers`,
 * LinkedIn `followerCount`, TikTok `follower_count`). This module declares the
 * translation from every provider's native vocabulary into the Unitos
 * canonical vocabulary defined in `./types.ts`.
 *
 * The frontend NEVER references native metric names — it only reads canonical
 * keys such as `followers`, `impressions`, `reach`, `engagement`, `likes`,
 * `comments`, `shares`, `saves`, `video_views`, `profile_visits`,
 * `followers_gained`, `followers_lost`, `link_clicks`.
 *
 * Providers should import the maps from this file instead of hard-coding
 * lookup tables inline.
 */

import type { CanonicalMetricKey, SocialNetwork } from "./types";

export type MetricScope = "account" | "post";

/** A single provider's native → canonical translation table. */
export type NativeMetricMap = Readonly<Record<string, CanonicalMetricKey>>;

/** Per-scope mapping table for one provider. */
export type ProviderMetricMap = Readonly<{
  account: NativeMetricMap;
  post: NativeMetricMap;
}>;

// ---------------------------------------------------------------------------
// Instagram (Meta Graph API — IG Business)
// ---------------------------------------------------------------------------
const INSTAGRAM: ProviderMetricMap = {
  account: {
    followers_count: "followers",
    // v22+: `impressions` deprecated at account level. `views` is the
    // replacement in the `total_value` endpoint.
    views: "impressions",
    reach: "reach",
    profile_views: "profile_visits",
    website_clicks: "link_clicks",
    accounts_engaged: "engagement",
    total_interactions: "engagement",
    follower_count: "followers_gained",
  },
  post: {
    // v22+: media `impressions` was removed. `views` is the canonical
    // replacement for feed/reels/video.
    views: "impressions",
    reach: "reach",
    likes: "likes",
    comments: "comments",
    saved: "saves",
    shares: "shares",
    total_interactions: "engagement",
  },
};

// ---------------------------------------------------------------------------
// Facebook Pages (Meta Graph API)
// ---------------------------------------------------------------------------
const FACEBOOK: ProviderMetricMap = {
  account: {
    fan_count: "followers",
    followers_count: "followers",
    page_followers: "followers",
    page_impressions: "impressions",
    page_impressions_unique: "reach",
    page_post_engagements: "engagement",
    page_actions_post_reactions_total: "engagement",
    page_fan_adds_unique: "followers_gained",
    page_fan_removes_unique: "followers_lost",
    page_views_total: "profile_visits",
  },
  post: {
    post_impressions: "impressions",
    post_impressions_unique: "reach",
    post_engaged_users: "engagement",
    post_clicks: "link_clicks",
    post_reactions_like_total: "likes",
    post_video_views: "video_views",
  },
};

// ---------------------------------------------------------------------------
// LinkedIn Pages (Marketing / Community Management API)
// Declared ahead of the provider implementation so the frontend contract
// is stable the day the provider ships.
// ---------------------------------------------------------------------------
const LINKEDIN: ProviderMetricMap = {
  account: {
    followerCount: "followers",
    followerCounts: "followers",
    impressionCount: "impressions",
    uniqueImpressionsCount: "reach",
    engagement: "engagement",
    clickCount: "link_clicks",
  },
  post: {
    impressionCount: "impressions",
    uniqueImpressionsCount: "reach",
    likeCount: "likes",
    commentCount: "comments",
    shareCount: "shares",
    clickCount: "link_clicks",
    engagement: "engagement",
  },
};

// ---------------------------------------------------------------------------
// TikTok (Business / Display API)
// ---------------------------------------------------------------------------
const TIKTOK: ProviderMetricMap = {
  account: {
    follower_count: "followers",
    profile_view: "profile_visits",
    video_view: "video_views",
    reach: "reach",
    impression: "impressions",
    engagement: "engagement",
  },
  post: {
    video_view: "video_views",
    play_count: "video_views",
    like_count: "likes",
    comment_count: "comments",
    share_count: "shares",
    reach: "reach",
    impression: "impressions",
  },
};

// ---------------------------------------------------------------------------
// YouTube (Data + Analytics API)
// ---------------------------------------------------------------------------
const YOUTUBE: ProviderMetricMap = {
  account: {
    subscriberCount: "followers",
    viewCount: "video_views",
    estimatedMinutesWatched: "engagement",
    subscribersGained: "followers_gained",
    subscribersLost: "followers_lost",
  },
  post: {
    views: "video_views",
    likes: "likes",
    comments: "comments",
    shares: "shares",
    subscribersGained: "followers_gained",
  },
};

// ---------------------------------------------------------------------------
// X / Twitter (v2 API)
// ---------------------------------------------------------------------------
const X: ProviderMetricMap = {
  account: {
    followers_count: "followers",
    impression_count: "impressions",
    profile_visits: "profile_visits",
    url_link_clicks: "link_clicks",
  },
  post: {
    impression_count: "impressions",
    like_count: "likes",
    reply_count: "comments",
    retweet_count: "shares",
    quote_count: "shares",
    bookmark_count: "saves",
    url_link_clicks: "link_clicks",
    video_view_count: "video_views",
  },
};

// ---------------------------------------------------------------------------
// Threads (Meta Graph — Threads API)
// ---------------------------------------------------------------------------
const THREADS: ProviderMetricMap = {
  account: {
    followers_count: "followers",
    views: "impressions",
  },
  post: {
    views: "impressions",
    likes: "likes",
    replies: "comments",
    reposts: "shares",
    quotes: "shares",
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const METRIC_MAP: Readonly<Record<SocialNetwork, ProviderMetricMap>> = {
  instagram: INSTAGRAM,
  facebook: FACEBOOK,
  linkedin: LINKEDIN,
  tiktok: TIKTOK,
  youtube: YOUTUBE,
  x: X,
  threads: THREADS,
};

/**
 * Translate a native metric name into the canonical vocabulary.
 * Returns `null` when the native metric has no canonical equivalent — callers
 * should either drop it or expose it under `native: true`.
 */
export function toCanonicalMetric(
  network: SocialNetwork,
  scope: MetricScope,
  nativeKey: string,
): CanonicalMetricKey | null {
  return METRIC_MAP[network]?.[scope]?.[nativeKey] ?? null;
}

/** Whole scoped table (useful for `toSeries` / `toPostMetrics` helpers). */
export function metricMapFor(network: SocialNetwork, scope: MetricScope): NativeMetricMap {
  return METRIC_MAP[network]?.[scope] ?? {};
}
