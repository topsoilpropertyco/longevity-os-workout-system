export type TrendSeries = {
  label: string;
  color: string;
  points: { x: string; y: number }[];
  dashed?: boolean;
};

/**
 * Line chart, hand-rolled SVG. One y-axis only (never two). Legend whenever a
 * second series appears; the single-series case is named by the title instead.
 * Each point carries a native <title> so a tap or hover reads the value.
 */
export default function TrendChart({
  series,
  title,
  yUnit,
  height = 168,
  plateau,
  yTicks = 3,
}: {
  series: TrendSeries[];
  title?: string;
  yUnit?: string;
  height?: number;
  plateau?: { fromIndex: number; note: string };
  yTicks?: number;
}) {
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  if (all.length === 0) return <div style={{ height }} />;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const lo = min - (max - min || 1) * 0.15;
  const hi = max + (max - min || 1) * 0.15;
  const W = 320;
  const H = height;
  const padL = 34;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const count = Math.max(...series.map((s) => s.points.length));
  const x = (i: number) => padL + (i / Math.max(1, count - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const ticks = Array.from({ length: yTicks }, (_, i) => lo + ((hi - lo) * i) / (yTicks - 1));
  const labels = series[0]?.points.map((p) => p.x) ?? [];

  return (
    <figure className="m-0">
      {(title || yUnit || series.length > 1) && (
        <figcaption className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-1.5">
            {title && <span className="text-sm font-semibold">{title}</span>}
            {yUnit && (
              <span className="text-[0.6875rem]" style={{ color: 'var(--ink-3)' }}>
                {yUnit}
              </span>
            )}
          </span>
          {series.length > 1 && (
            <ul className="flex flex-wrap gap-3">
              {series.map((s) => (
                <li key={s.label} className="flex items-center gap-1.5 text-[0.6875rem]" style={{ color: 'var(--ink-2)' }}>
                  <span aria-hidden="true" className="inline-block h-[3px] w-4 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
        </figcaption>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title ?? series.map((s) => s.label).join(', ')}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={padL - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" style={{ fill: 'var(--ink-3)', fontSize: 9 }}>
              {Math.abs(t) >= 1000 ? `${(t / 1000).toFixed(1)}k` : t.toFixed(t < 10 ? 1 : 0)}
            </text>
          </g>
        ))}

        {plateau && count > plateau.fromIndex && (
          <rect
            x={x(plateau.fromIndex)}
            y={padT}
            width={W - padR - x(plateau.fromIndex)}
            height={H - padT - padB}
            fill="var(--warn)"
            opacity="0.10"
          />
        )}

        {series.map((s) => {
          const d = s.points
            .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.y).toFixed(2)}`)
            .join(' ');
          return (
            <g key={s.label}>
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={s.dashed ? '4 4' : undefined}
              />
              {s.points.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p.y)} r={i === s.points.length - 1 ? 3.4 : 2.2} fill={s.color} stroke="var(--surface)" strokeWidth="1">
                  <title>{`${s.label} · ${p.x} · ${p.y}${yUnit ? ` ${yUnit}` : ''}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {labels.map((l, i) =>
          i === 0 || i === labels.length - 1 || i === Math.floor(labels.length / 2) ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'} style={{ fill: 'var(--ink-3)', fontSize: 9 }}>
              {l}
            </text>
          ) : null,
        )}

        {/*
          The unit belongs in the caption, not floating at the axis origin. Drawn
          inside the SVG at (0, padT) it lands directly on top of the top tick
          label — "0–10" and "4.3" printed over each other, which is how the pain
          chart shipped before anyone looked at it on a phone.
        */}
      </svg>

      {plateau && (
        <p className="mt-1 text-xs" style={{ color: 'var(--warn)' }}>
          ▲ {plateau.note}
        </p>
      )}
    </figure>
  );
}
