import { useState } from "react";
import { X } from "lucide-react";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const emailSchema = z.string().trim().toLowerCase().email().max(255);

/** Normaliza e valida um e-mail; retorna null quando inválido. */
export function normalizeEmail(raw: string): string | null {
  const parsed = emailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Campo de e-mails em etiquetas (tag input). Enter, vírgula ou espaço confirmam
 * a etiqueta; colar uma lista cria várias de uma vez; Backspace com o campo
 * vazio remove a última. E-mail inválido é bloqueado com aviso inline.
 */
export function EmailTagsInput({
  value,
  onChange,
  id,
  placeholder = "pessoa@empresa.com",
  hint,
  disabled,
  max,
  className,
}: {
  value: string[];
  onChange: (emails: string[]) => void;
  id?: string;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  max?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addMany = (raws: string[]) => {
    const next = [...value];
    let invalid: string | null = null;
    for (const raw of raws) {
      const clean = raw.trim();
      if (!clean) continue;
      const email = normalizeEmail(clean);
      if (!email) {
        invalid = clean;
        continue;
      }
      if (next.includes(email)) continue;
      if (max && next.length >= max) break;
      next.push(email);
    }
    if (next.length !== value.length) onChange(next);
    setError(invalid ? `E-mail inválido: ${invalid}` : null);
    return invalid === null;
  };

  const commitDraft = () => {
    if (!draft.trim()) return true;
    const ok = addMany([draft]);
    if (ok) setDraft("");
    return ok;
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " " || e.key === "Tab") {
      if (e.key === "Tab" && !draft.trim()) return;
      e.preventDefault();
      commitDraft();
      return;
    }
    if (e.key === "Backspace" && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
      setError(null);
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "flex min-h-[42px] flex-wrap gap-1.5 rounded-md border bg-transparent px-2 py-1.5",
          error ? "border-destructive" : "border-input",
          disabled && "opacity-60",
        )}
      >
        {value.map((email) => (
          <Badge key={email} variant="secondary" className="gap-1 pr-1 font-normal">
            {email}
            <button
              type="button"
              aria-label={`Remover ${email}`}
              disabled={disabled}
              onClick={() => {
                onChange(value.filter((x) => x !== email));
                setError(null);
              }}
              className="rounded-sm p-0.5 hover:bg-muted"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          id={id}
          type="email"
          value={draft}
          disabled={disabled || (!!max && value.length >= max)}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKey}
          onBlur={() => commitDraft()}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (!/[,;\s]/.test(text)) return;
            e.preventDefault();
            addMany(text.split(/[,;\s]+/));
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          className="h-7 min-w-[160px] flex-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
          autoComplete="off"
        />
      </div>
      {error ? (
        <p className="text-[11px] leading-snug text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
