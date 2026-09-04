/**
 * Textarea com menções `@`.
 *
 * A fonte de verdade das menções é sempre o TEXTO: `resolveMentions()` extrai
 * os IDs a partir dos nomes presentes no corpo, então apagar o `@Nome` remove
 * a menção automaticamente (sem IDs órfãos).
 */
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type MentionPerson = { id: string; name: string; avatar_url?: string | null };

function initials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

/** IDs das pessoas realmente mencionadas no texto (match por nome completo). */
export function resolveMentions(text: string, people: MentionPerson[]): string[] {
  const lower = text.toLowerCase();
  const ids = new Set<string>();
  for (const p of people) {
    const name = p.name.trim();
    if (!name) continue;
    if (lower.includes(`@${name.toLowerCase()}`)) ids.add(p.id);
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
  onChange: (value: string) => void;
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
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.trim().toLowerCase();
    const list = q ? people.filter((p) => p.name.toLowerCase().includes(q)) : people;
    return list.slice(0, 8);
  }, [trigger, people]);

  const open = !!trigger && suggestions.length > 0;

  function sync(text: string, caret: number) {
    const next = activeQuery(text, caret);
    setTrigger(next);
    setHighlight(0);
  }

  function pick(person: MentionPerson) {
    if (!trigger) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, trigger.start)}@${person.name} ${value.slice(caret)}`;
    onChange(next);
    setTrigger(null);
    requestAnimationFrame(() => {
      const pos = trigger.start + person.name.length + 2;
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
          onChange(e.target.value);
          sync(e.target.value, e.target.selectionStart ?? e.target.value.length);
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
          className="absolute bottom-full left-0 z-30 mb-2 w-64 overflow-hidden rounded-md border border-border bg-popover py-1 shadow-md"
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
                <Avatar className="h-5 w-5">
                  {p.avatar_url ? <AvatarImage src={p.avatar_url} alt="" /> : null}
                  <AvatarFallback className="text-[9px]">{initials(p.name)}</AvatarFallback>
                </Avatar>
                <span className="truncate">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
