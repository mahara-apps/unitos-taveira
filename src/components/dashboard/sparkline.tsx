type Props = { data: number[]; className?: string; color?: string };

export function Sparkline({ data, className, color = "currentColor" }: Props) {
  if (!data.length) return null;
  const max = Math.max(1, ...data);
  const w = 80;
  const h = 22;
  const step = w / Math.max(1, data.length - 1);
  const points = data
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  const area = `0,${h} ${points} ${w},${h}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      preserveAspectRatio="none"
      style={{ color }}
    >
      <polygon points={area} fill="currentColor" opacity="0.15" />
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
