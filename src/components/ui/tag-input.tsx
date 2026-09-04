import { X } from "lucide-react";
import { useState, KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  tone?: "default" | "success" | "danger" | "info";
};

const TONE_CLASSES: Record<NonNullable<Props["tone"]>, string> = {
  default: "border-border bg-muted text-foreground",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300",
  danger:
    "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300",
};

export function TagInput({ value, onChange, placeholder, disabled, tone = "default" }: Props) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (value.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...value, v]);
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  const cls = TONE_CLASSES[tone];
  return (
    <div className="space-y-2">
      {value.length ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v, i) => (
            <span
              key={`${v}-${i}`}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-normal ${cls}`}
            >
              {v}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  className="rounded-full opacity-70 hover:opacity-100"
                  aria-label={`Remover ${v}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : null}
      {!disabled && (
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={placeholder ?? "Digite e pressione Enter"}
          className="h-8 text-xs"
        />
      )}
    </div>
  );
}
