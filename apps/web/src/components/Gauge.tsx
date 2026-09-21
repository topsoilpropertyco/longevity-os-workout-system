/**
 * ACWR-style gauge: a 240° arc with the safe window drawn in, a needle, and the
 * status spelled out in words underneath so it never reads by colour alone.
 */
export default function Gauge({
  value,
  min = 0,
  max = 2,
  safe = [0.8, 1.3],
  label,
  format,
}: {
  value: number;
  min?: number;
  max?: number;
  safe?: [number, number];
  label: string;
  format?: (v: number) => string;
}) {
  const W = 120;
  const H = 76;
  const cx = W / 2;
  const cy = 64;
  const r = 46;
  const start = -210;
  const sweep = 240;
  const toAngle = (v: number) => start + ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * sweep;
  const pt = (angle: number, radius: number) => {
    const rad = (angle * Math.PI) / 180;
    return [cx + Math.cos(rad) * radius, cy + Math.sin(rad) * radius] as const;
  };
  const arc = (a0: number, a1: number, radius: number) => {
    const [x0, y0] = pt(a0, radius);
    const [x1, y1] = pt(a1, radius);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M${x0},${y0} A${radius},${radius} 0 ${large} 1 ${x1},${y1}`;
  };

  const inSafe = value >= safe[0] && value <= safe[1];
  const status = inSafe ? 'In range' : value < safe[0] ? 'Under-loaded' : 'Spiking';
  const tone = inSafe ? 'var(--good)' : value < safe[0] ? 'var(--s1)' : 'var(--bad)';
  const needle = pt(toAngle(value), r - 6);

  return (
    <figure className="m-0 text-center">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${label}: ${value.toFixed(2)}, ${status}`}>
        <path d={arc(start, start + sweep, r)} fill="none" stroke="var(--surface-2)" strokeWidth="9" strokeLinecap="round" />
        <path d={arc(toAngle(safe[0]), toAngle(safe[1]), r)} fill="none" stroke="var(--good)" strokeWidth="9" strokeLinecap="round" opacity="0.5" />
        <line x1={cx} y1={cy} x2={needle[0]} y2={needle[1]} stroke={tone} strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="3.6" fill={tone} />
        <text x={cx} y={cy - 12} textAnchor="middle" className="num" style={{ fill: 'var(--ink)', fontSize: 16, fontWeight: 700 }}>
          {format ? format(value) : value.toFixed(2)}
        </text>
      </svg>
      <figcaption className="-mt-1">
        <div className="text-xs font-semibold">{label}</div>
        <div className="text-[0.625rem]" style={{ color: tone }}>
          {status}
        </div>
      </figcaption>
    </figure>
  );
}
