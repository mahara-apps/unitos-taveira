/**
 * Textarea com menções `@`.
 *
 * O texto visível contém somente `@Nome`. A identidade escolhida fica separada
 * no estado do compositor, evitando expor IDs no campo, nas prévias ou no banco.
 * Tokens antigos `@[Nome](uuid)` continuam sendo reconhecidos e saneados.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { displayName, initialsOf } from "@/lib/identity";
import { cleanMentionText, MENTION_TOKEN_RE } from "@/lib/mentions";

export { cleanMentionText, MENTION_TOKEN_RE } from "@/lib/mentions";

export type MentionPerson = {
  id: string;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
};

const TOKEN_GLOBAL = new RegExp(MENTION_TOKEN_RE.source, "gi");

/** Rótulo exibido na lista: nome + e-mail para desambiguar homônimos. */
export function personLabel(p: MentionPerson): string {
  return displayName({ name: p.name, email: p.email });
}

/** IDs das pessoas realmente mencionadas no texto. */
export function resolveMentions(text: string, people: MentionPerson[]): string[] {
  const ids = new Set<string>();
  const known = new Set(people.map((p) => p.id));

  // 1) Tokens explícitos — pessoa exata escolhida na lista.
  let stripped = text;
  for (const m of text.matchAll(TOKEN_GLOBAL)) {
    const id = /\(([^)]+)\)$/.exec(m[0])?.[1];
    if (id && known.has(id)) ids.add(id);
    stripped = stripped.replace(m[0], " ");
  }

  // 2) Compatibilidade: `@Nome` puro. Nomes ambíguos são ignorados de propósito.
  const lower = stripped.toLowerCase();
  for (const p of people) {
    const name = personLabel(p).trim();
    if (!name) continue;
    if (!lower.includes(`@${name.toLowerCase()}`)) continue;
    const homonyms = people.filter(
      (o) => personLabel(o).trim().toLowerCase() === name.toLowerCase(),
    );
    if (homonyms.length === 1) ids.add(p.id);
  }
  return Array.from(ids);
}

/** Trecho digitado após o `@` mais recente antes do caret, ou null. */
function activeQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const prevChar = at === 0 ? "" : before[at - 1]!;
  if (prevChar && !/[\s(]/.test(prevChar)) return null;
  const query = before.slice(at + 1);
  if (/\n/.test(query) || query.length > 40) return null;
  return { start: at, query };
}

type Props = {
  value: string;
  onChange: (value: string, mentionIds: string[]) => void;
  people: MentionPerson[];
  placeholder?: string;
  rows?: number;
  className?: string;
  /** Cmd/Ctrl+Enter */
  onSubmit?: () => void;
  disabled?: boolean;
};

export function MentionTextarea({
  value,
  onChange,
  people,
  placeholder,
  rows = 2,
  className,
  onSubmit,
  disabled,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const selectionsRef = useRef<Array<{ id: string; label: string }>>([]);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.trim().toLowerCase();
    const list = q
      ? people.filter(
          (p) =>
            personLabel(p).toLowerCase().includes(q) || (p.email ?? "").toLowerCase().includes(q),
        )
      : people;
    return list.slice(0, 8);
  }, [trigger, people]);

  const open = !!trigger && suggestions.length > 0;

  function sync(text: string, caret: number) {
    const next = activeQuery(text, caret);
    setTrigger(next);
    setHighlight(0);
  }

  function activeMentionIds(text: string) {
    const remainingByLabel = new Map<string, number>();
    for (const selection of selectionsRef.current) {
      const key = selection.label.toLocaleLowerCase("pt-BR");
      if (remainingByLabel.has(key)) continue;
      const escaped = selection.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = text.match(new RegExp(`@${escaped}(?=$|[\\s.,;:!?\\)])`, "giu"));
      remainingByLabel.set(key, matches?.length ?? 0);
    }

    const active: Array<{ id: string; label: string }> = [];
    for (const selection of selectionsRef.current) {
      const key = selection.label.toLocaleLowerCase("pt-BR");
      const remaining = remainingByLabel.get(key) ?? 0;
      if (remaining <= 0) continue;
      active.push(selection);
      remainingByLabel.set(key, remaining - 1);
    }
    selectionsRef.current = active;
    return Array.from(new Set(active.map((selection) => selection.id)));
  }

  function pick(person: MentionPerson) {
    if (!trigger) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const label = personLabel(person);
    const mention = `@${label}`;
    const next = `${value.slice(0, trigger.start)}${mention} ${value.slice(caret)}`;
    selectionsRef.current = [...selectionsRef.current, { id: person.id, label }];
    onChange(next, activeMentionIds(next));
    setTrigger(null);
    requestAnimationFrame(() => {
      const pos = trigger.start + mention.length + 1;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const person = suggestions[highlight] ?? suggestions[0];
        if (person) pick(person);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setTrigger(null);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        className={cn("resize-none text-sm", className)}
        onChange={(e) => {
          const next = cleanMentionText(e.target.value);
          onChange(next, activeMentionIds(next));
          sync(next, e.target.selectionStart ?? next.length);
        }}
        onClick={(e) => sync(value, e.currentTarget.selectionStart ?? value.length)}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            sync(value, e.currentTarget.selectionStart ?? value.length);
          }
        }}
        onBlur={() => window.setTimeout(() => setTrigger(null), 120)}
        onKeyDown={handleKeyDown}
      />
      {open ? (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-30 mb-2 w-80 max-w-[90vw] overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {suggestions.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  i === highlight ? "bg-muted" : "hover:bg-muted/60",
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(p)}
              >
                <Avatar className="h-6 w-6">
                  {p.avatar_url ? <AvatarImage src={p.avatar_url} alt="" /> : null}
                  <AvatarFallback className="text-[9px]">
                    {initialsOf({ name: p.name, email: p.email })}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{personLabel(p)}</span>
                  {p.email ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {p.email}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
