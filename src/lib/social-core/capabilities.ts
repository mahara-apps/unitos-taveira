/**
 * Social Core — Capabilities matrix.
 *
 * Isomorphic (safe no client). Descreve, por canal, quais operações do
 * Social Core estão disponíveis na V1. Consumidores (UI, agendador,
 * automações, Brain) devem verificar aqui antes de oferecer uma ação.
 *
 * Este arquivo é a única fonte da verdade sobre "o que cada rede suporta"
 * no Unitos. Ao adicionar um provider, atualize a matriz.
 */

export const SOCIAL_CHANNELS = [
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "youtube",
  "x",
  "threads",
] as const;

export type SocialChannel = (typeof SOCIAL_CHANNELS)[number];

export type CapabilityKey =
  | "connect"
  | "disconnect"
  | "refreshToken"
  | "publish.feed"
  | "publish.story"
  | "publish.reel"
  | "schedule"
  | "analytics.dashboard"
  | "analytics.posts"
  | "analytics.topPosts"
  | "analytics.audience"
  | "analytics.profile";

export type ChannelCapabilities = Readonly<Record<CapabilityKey, boolean>>;

const NONE: ChannelCapabilities = Object.freeze({
  connect: false,
  disconnect: false,
  refreshToken: false,
  "publish.feed": false,
  "publish.story": false,
  "publish.reel": false,
  schedule: false,
  "analytics.dashboard": false,
  "analytics.posts": false,
  "analytics.topPosts": false,
  "analytics.audience": false,
  "analytics.profile": false,
});

function caps(overrides: Partial<ChannelCapabilities>): ChannelCapabilities {
  return Object.freeze({ ...NONE, ...overrides });
}

/** Matriz oficial V1 — ampliar conforme novos providers forem plugados. */
export const CHANNEL_CAPABILITIES: Readonly<Record<SocialChannel, ChannelCapabilities>> =
  Object.freeze({
    facebook: caps({
      connect: true,
      disconnect: true,
      refreshToken: true,
      "publish.feed": true,
      schedule: true,
      "analytics.dashboard": true,
      "analytics.posts": true,
      "analytics.topPosts": true,
      "analytics.audience": true,
      "analytics.profile": true,
    }),
    instagram: caps({
      connect: true,
      disconnect: true,
      refreshToken: true,
      "publish.feed": true,
      schedule: true,
      "analytics.dashboard": true,
      "analytics.posts": true,
      "analytics.topPosts": true,
      "analytics.audience": true,
      "analytics.profile": true,
    }),
    linkedin: NONE,
    tiktok: NONE,
    youtube: NONE,
    x: NONE,
    threads: NONE,
  });

export function getCapabilities(channel: SocialChannel): ChannelCapabilities {
  return CHANNEL_CAPABILITIES[channel] ?? NONE;
}

export function isCapable(channel: SocialChannel, key: CapabilityKey): boolean {
  return getCapabilities(channel)[key] === true;
}

export function listSupportedChannels(): SocialChannel[] {
  return SOCIAL_CHANNELS.filter((c) => CHANNEL_CAPABILITIES[c]["connect"]);
}
