/** `@[Nome](uuid)` — formato legado mantido apenas para compatibilidade. */
export const MENTION_TOKEN_RE =
  /@\[[^\]\n]+\]\([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/i;

const TOKEN_GLOBAL = new RegExp(MENTION_TOKEN_RE.source, "gi");

/** Remove identificadores técnicos sem alterar o nome visível da menção. */
export function cleanMentionText(text: string): string {
  return text.replace(TOKEN_GLOBAL, (token) => {
    const named = /^@\[([^\]]+)\]\([^)]+\)$/i.exec(token);
    return named ? `@${named[1]}` : token;
  });
}