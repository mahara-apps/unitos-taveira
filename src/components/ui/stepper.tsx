import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact numeric stepper used for per-channel volume targets and any other
 * small bounded-integer input. Shares the app's input border/radius language.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  suffix,
  label,
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  label?: string;
  className?: string;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n || 0)));
  return (
    <div
      data-stepper
      className={cn(
        "inline-flex h-7 items-stretch overflow-hidden rounded-md border border-border bg-background",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
        aria-label={label ? `Diminuir ${label}` : "Diminuir"}
        className="grid w-7 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Minus className="h-3 w-3" />
      </button>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="w-10 border-x border-border bg-transparent text-center text-xs font-medium tabular-nums outline-none [appearance:textfield] focus:bg-muted/40 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
        aria-label={label ? `Aumentar ${label}` : "Aumentar"}
        className="grid w-7 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Plus className="h-3 w-3" />
      </button>
      {suffix ? (
        <span className="grid place-items-center px-2 text-[10px] text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}
