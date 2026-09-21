export type BarSeries = { label: string; color: string; values: number[] };

/**
 * Stacked or grouped bars, hand-rolled. 2px gaps between segments and bars,
 * 4px rounded ends on the outermost segment, legend for every multi-series
 * chart, one y-axis.
 */
export default function BarsChart({
  categories,
  series,
  stacked = true,
  title,
  yUnit,
  height = 176,
}: {
  categories: string[];
  series: BarSeries[];
  stacked?: boolean;
  title?: string;
  yUnit?: string;
  height?: number;
}) {
  const W = 320;
  const H = height;
  const padL = 30;
  const padR = 6;
  const padT = 8;
  const padB = 20;
  const inner = W - padL - padR;
  const bandW = inner / Math.max(1, categories.length);
  const totals = categories.map((_, i) =>
    stacked ? series.reduce((s, ser) => s + (ser.values[i] ?? 0), 0) : Math.max(...series.map((ser) => ser.values[i] ?? 0)),
  );
  const max = Math.max(1, ...totals);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const ticks = [0, max / 2, max];

  return (
    <figure className="m-0">
      {(title || series.length > 1) && (
        <figcaption className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          {title && <span className="text-sm font-semibold">{title}</span>}
          {series.length > 1 && (
            <ul className="flex flex-wrap gap-3">
              {series.map((s) => (
                <li key={s.label} className="flex items-center gap-1.5 text-[0.6875rem]" style={{ color: 'var(--ink-2)' }}>
                  <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
        </figcaption>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={title ?? 'Bar chart'}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={padL - 5} y={y(t)} textAnchor="end" dominantBaseline="middle" style={{ fill: 'var(--ink-3)', fontSize: 9 }}>
              {t >= 1000 ? `${(t / 1000).toFixed(1)}k` : Math.round(t)}
            </text>
          </g>
        ))}

        {categories.map((cat, i) => {
          const groupW = bandW * 0.62;
          const x0 = padL + bandW * i + (bandW - groupW) / 2;
          let acc = 0;
          return (
            <g key={cat}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                if (stacked) {
                  const h = (v / max) * (H - padT - padB);
                  const yTop = y(acc + v);
                  acc += v;
                  return (
                    <rect
                      key={s.label}
                      x={x0}
                      y={yTop}
                      width={groupW}
                      height={Math.max(0, h - 2)}
                      rx={si === series.length - 1 ? 4 : 1}
                      fill={s.color}
                    >
                      <title>{`${cat} · ${s.label}: ${Math.round(v)}${yUnit ? ` ${yUnit}` : ''}`}</title>
                    </rect>
                  );
                }
                const bw = (groupW - 2 * (series.length - 1)) / series.length;
                const h = (v / max) * (H - padT - padB);
                return (
                  <rect key={s.label} x={x0 + si * (bw + 2)} y={y(v)} width={bw} height={Math.max(0, h)} rx={3} fill={s.color}>
                    <title>{`${cat} · ${s.label}: ${Math.round(v)}${yUnit ? ` ${yUnit}` : ''}`}</title>
                  </rect>
                );
              })}
              <text x={x0 + groupW / 2} y={H - 6} textAnchor="middle" style={{ fill: 'var(--ink-3)', fontSize: 9 }}>
                {cat}
              </text>
            </g>
          );
        })}

        {yUnit && (
          <text x={padL - 5} y={padT - 1} textAnchor="end" style={{ fill: 'var(--ink-3)', fontSize: 8 }}>
            {yUnit}
          </text>
        )}
      </svg>
    </figure>
  );
}
