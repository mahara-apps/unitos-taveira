/**
 * Renderiza o corpo de um comentário destacando as menções `@Nome` e
 * transformando URLs colados (Drive, Figma…) em links clicáveis.
 */
import type { ReactNode } from "react";
import type { MentionPerson } from "@/components/ui/mention-textarea";

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

export function MentionText({ text, people }: { text: string; people?: MentionPerson[] }) {
  const names = (people ?? [])
    .map((p) => p.name.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  const pattern = names.length > 0 ? `@(?:${names.join("|")})` : "@[\\p{L}\\p{N}_]+";
  const re = new RegExp(`(${pattern})`, "giu");

  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(...linkify(text.slice(last, idx), `t${last}`));
    out.push(
      <span key={`${idx}-${m[0]}`} className="rounded bg-primary/10 px-1 font-medium text-primary">
        {m[0]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(...linkify(text.slice(last), `t${last}`));

  return <>{out}</>;
}

