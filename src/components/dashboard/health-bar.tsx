import { cn } from "@/lib/utils";

export function HealthBar({ score, className }: { score: number; className?: string }) {
  const tone =
    score >= 75
      ? "var(--color-health-good)"
      : score >= 50
        ? "var(--color-health-warn)"
        : "var(--color-health-bad)";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(4, Math.min(100, score))}%`, background: tone }}
      />
    </div>
  );
}
