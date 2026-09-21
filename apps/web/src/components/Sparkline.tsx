/**
 * Sparkline: one series, no axes, no legend — the tile's label names it.
 * The final point is marked so "where it ended" never needs a tooltip.
 */
export default function Sparkline({
  values,
  height = 30,
  color = 'var(--s1)',
  area = true,
  label,
}: {
  values: number[];
  height?: number;
  color?: string;
  area?: boolean;
  label?: string;
}) {
  if (values.length < 2) return <div style={{ height }} aria-hidden="true" />;
  const w = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const last = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-label={label ?? `Trend, ${values.length} points, ending at ${values[values.length - 1]}`}
    >
      {area && (
        <path
          d={`${d} L${w},${height} L0,${height} Z`}
          fill={color}
          opacity="0.12"
        />
      )}
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} stroke="var(--surface)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
