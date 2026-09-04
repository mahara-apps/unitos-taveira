/**
 * Fonte única do NOME EXIBIDO de um canal/conexão.
 *
 * Regra do produto: o nome do canal é SEMPRE a plataforma
 * (Instagram, Facebook, TikTok, YouTube…), nunca o nome do perfil.
 * O identificador do perfil aparece apenas como complemento (`@usuario`),
 * junto do ícone da plataforma.
 */

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X / Twitter",
  twitter: "X / Twitter",
  youtube: "YouTube",
  threads: "Threads",
  blog: "Blog",
  whatsapp: "WhatsApp",
  meta: "Meta",
};

/** Nome do canal = plataforma. Nunca o nome do perfil. */
export function channelDisplayLabel(raw: string | null | undefined): string {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return "Canal";
  return CHANNEL_LABEL[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export type ConnectionNameSource = {
  channel_name?: string | null;
  external_name?: string | null;
  account_username?: string | null;
  channel?: string | null;
  provider?: string | null;
};

/** Nome do canal de uma conexão: plataforma (`channel`, com fallback ao provider). */
export function connectionDisplayName(row: ConnectionNameSource): string {
  return channelDisplayLabel(row.channel ?? row.provider);
}

/** Complemento do canal: `@usuario` quando existir. Nunca substitui o nome. */
export function connectionHandle(row: ConnectionNameSource): string | null {
  const user = typeof row.account_username === "string" ? row.account_username.trim() : "";
  if (user) return `@${user.replace(/^@/, "")}`;
  return null;
}
