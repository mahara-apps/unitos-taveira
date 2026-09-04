import type { SocialAnalyticsProvider } from "./provider";
import type { SocialNetwork } from "./types";
import { MetaAnalyticsProvider } from "./providers/meta.server";
import { makeNotImplementedProvider } from "./providers/stubs.server";

/**
 * Provider registry. Lookup is keyed by `SocialNetwork`. Unimplemented
 * networks fall back to a stub so the frontend can still list them uniformly.
 *
 * The Meta provider is created lazily: its constructor reads env secrets
 * (META_APP_ID / META_APP_SECRET) and must not throw at module-eval time,
 * otherwise importing this file crashes the whole app.
 */
let metaInstance: MetaAnalyticsProvider | null = null;
function meta(): SocialAnalyticsProvider {
  if (!metaInstance) metaInstance = new MetaAnalyticsProvider();
  return metaInstance;
}

const STUBS = {
  linkedin: makeNotImplementedProvider("linkedin", "LinkedIn"),
  tiktok: makeNotImplementedProvider("tiktok", "TikTok"),
  youtube: makeNotImplementedProvider("youtube", "YouTube"),
  x: makeNotImplementedProvider("x", "X (Twitter)"),
  threads: makeNotImplementedProvider("threads", "Threads"),
} satisfies Partial<Record<SocialNetwork, SocialAnalyticsProvider>>;

const LABELS: Record<SocialNetwork, string> = {
  facebook: "Meta",
  instagram: "Meta",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X (Twitter)",
  threads: "Threads",
};

export function getSocialProvider(network: SocialNetwork): SocialAnalyticsProvider {
  if (network === "facebook" || network === "instagram") return meta();
  return STUBS[network];
}

export function listSocialProviders(): Array<{
  network: SocialNetwork;
  label: string;
  implemented: boolean;
}> {
  return (Object.keys(LABELS) as SocialNetwork[]).map((network) => ({
    network,
    label: LABELS[network],
    implemented: network === "facebook" || network === "instagram",
  }));
}
