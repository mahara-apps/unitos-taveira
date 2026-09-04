/**
 * Client-safe AI provider capabilities.
 * Kept out of `*.server.ts` so the UI and `*.functions.ts` can import it.
 */

export type ProviderName = "openai" | "anthropic" | "gemini" | "groq";
export type ProviderRole = "strategic" | "operational" | "image";
export type ProviderKind = "text" | "image";

export const PROVIDER_CAPABILITIES: Record<ProviderName, { text: boolean; image: boolean }> = {
  openai: { text: true, image: true },
  anthropic: { text: true, image: false },
  gemini: { text: true, image: true },
  // Groq serve texto em alta velocidade; não gera imagem.
  groq: { text: true, image: false },
};

export const TEXT_PROVIDERS = (Object.keys(PROVIDER_CAPABILITIES) as ProviderName[]).filter(
  (p) => PROVIDER_CAPABILITIES[p].text,
);

export const IMAGE_PROVIDERS = (Object.keys(PROVIDER_CAPABILITIES) as ProviderName[]).filter(
  (p) => PROVIDER_CAPABILITIES[p].image,
);

export function supportsKind(provider: ProviderName, kind: ProviderKind): boolean {
  return PROVIDER_CAPABILITIES[provider]?.[kind] === true;
}
