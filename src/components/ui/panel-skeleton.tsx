/**
 * List-shaped loading placeholder used inside PanelCard bodies.
 * Mirrors the Dashboard's `SkeletonList`.
 */
export function PanelSkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded-md bg-muted/40" />
      ))}
    </div>
  );
}
