/**
 * Renderiza o corpo de um comentário destacando as menções e transformando
 * URLs colados (Drive, Figma…) em links clicáveis.
 *
 * Menções novas vêm no token estável `@[Nome](uuid)`; comentários antigos
 * gravados como `@Nome` continuam sendo destacados por compatibilidade.
 */
import type { ReactNode } from "react";
import type { MentionPerson } from "@/components/ui/mention-textarea";
import { MENTION_TOKEN_RE } from "@/components/ui/mention-textarea";

/** Quebra um trecho de texto puro em nós, linkificando http(s):// e www. */
function linkify(text: string, keyPrefix: string): ReactNode[] {
  const re = /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+)/gi;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const raw = m[0].replace(/[.,;:!?)]+$/, "");
    const href = raw.startsWith("http") ? raw : `https://${raw}`;
    out.push(
      <a
        key={`${keyPrefix}-${idx}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary underline underline-offset-2"
      >
        {raw}
      </a>,
    );
    last = idx + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded bg-primary/10 px-1 font-medium text-primary">{label}</span>
  );
}

export function MentionText({ text, people }: { text: string; people?: MentionPerson[] }) {
  const names = (people ?? [])
    .map((p) => p.name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const legacy = names.length > 0 ? `@(?:${names.join("|")})` : "@[\\p{L}\\p{N}_]+";
  const re = new RegExp(`(${MENTION_TOKEN_RE.source}|${legacy})`, "giu");

  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(...linkify(text.slice(last, idx), `t${last}`));
    const token = m[0];
    const named = /^@\[([^\]]+)\]\(([0-9a-f-]{36})\)$/i.exec(token);
    out.push(<Chip key={`${idx}-${token}`} label={named ? `@${named[1]}` : token} />);
    last = idx + token.length;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), `t${last}`));

  return <>{out}</>;
}
