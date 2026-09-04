import { MetaProvider } from "./providers/meta.server";
import type { SocialProvider } from "./provider";
import type { SocialNetwork } from "./types";

/**
 * Registry of high-level Social Providers. Add a new implementation here to
 * expose it network-wide — the frontend keeps talking to the canonical
 * SocialProvider interface and never sees the network-specific API.
 *
 * Providers are instantiated lazily: their constructors read env secrets
 * (e.g. META_APP_ID) and must not throw while this module is evaluated,
 * otherwise every importer (and the whole app) crashes at load time.
 */
let cached: readonly SocialProvider[] | null = null;

function buildProviders(): readonly SocialProvider[] {
  const providers: SocialProvider[] = [];
  const factories: Array<() => SocialProvider> = [() => new MetaProvider()];

  for (const make of factories) {
    try {
      providers.push(make());
    } catch (err) {
      console.warn(
        "[social/registry] provider unavailable (missing configuration):",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return providers;
}

export function listSocialProviders(): readonly SocialProvider[] {
  if (!cached) cached = buildProviders();
  return cached;
}

export function getSocialProviderForNetwork(network: SocialNetwork): SocialProvider | null {
  return (
    listSocialProviders().find((p) => (p.networks as readonly SocialNetwork[]).includes(network)) ??
    null
  );
}

/** Matches the `provider` column of `social_connections` (e.g. "meta"). */
export function getSocialProviderByKey(key: string): SocialProvider | null {
  const label = key.toLowerCase();
  return listSocialProviders().find((p) => p.label.toLowerCase() === label) ?? null;
}
