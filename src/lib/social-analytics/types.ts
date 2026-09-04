/**
 * Social Analytics — canonical data model.
 *
 * Every provider (Meta, LinkedIn, TikTok, YouTube, X, Threads…) must map its
 * native metrics into these shapes so the frontend never depends on any
 * network-specific API surface.
 */

export type SocialNetwork =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "x"
  | "threads";

export const SUPPORTED_NETWORKS: readonly SocialNetwork[] = [
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube",
  "x",
  "threads",
] as const;

/**
 * Canonical metric vocabulary. Providers should map to these keys whenever
 * a native metric is semantically equivalent. Unknown/native-only metrics
 * are exposed under `native` with the original key preserved.
 */
export type CanonicalMetricKey =
  | "impressions"
  | "reach"
  | "engagement"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "video_views"
  | "profile_visits"
  | "followers_gained"
  | "followers_lost"
  | "followers"
  | "link_clicks";

export type Metric = {
  key: CanonicalMetricKey | string;
  value: number;
  /** True when `key` is not part of the canonical vocabulary. */
  native?: boolean;
};

export type DateRange = {
  /** ISO-8601 timestamp, inclusive. */
  since: string;
  /** ISO-8601 timestamp, inclusive. */
  until: string;
};

export type TimeSeriesPoint = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  metrics: Metric[];
};

export type AccountAnalytics = {
  network: SocialNetwork;
  connectionId: string;
  accountId: string;
  accountName: string | null;
  accountHandle: string | null;
  range: DateRange;
  followers: number | null;
  metrics: Metric[];
  series: TimeSeriesPoint[];
  warnings: string[];
};

export type PostAnalytics = {
  network: SocialNetwork;
  connectionId: string;
  externalPostId: string;
  permalink: string | null;
  publishedAt: string | null;
  placement: string | null;
  caption: string | null;
  mediaType: "image" | "video" | "carousel" | "text" | "other" | null;
  metrics: Metric[];
  warnings: string[];
};

/** Result envelope used by every provider call — never throws for partials. */
export type ProviderResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
