'use client';

/** Shared dial for every clock: a progress ring and one very large number. */
export default function ClockFace({
  progress,
  primary,
  caption,
  sub,
  tone = 'var(--accent)',
  size = 232,
}: {
  progress: number; // 0..1
  primary: string;
  caption?: string;
  sub?: string;
  tone?: string;
  size?: number;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${p * c} ${c - p * c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 120ms linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {caption && <span className="label">{caption}</span>}
        <span className="num-lg leading-none" style={{ fontSize: size * 0.26 }}>
          {primary}
        </span>
        {sub && (
          <span className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}
