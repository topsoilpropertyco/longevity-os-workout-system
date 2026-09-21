import type { ReadinessAssessment } from '@/lib/engine-bridge';

const BAND: Record<ReadinessAssessment['band'], { label: string; color: string }> = {
  push: { label: 'Push', color: 'var(--good)' },
  as_planned: { label: 'As planned', color: 'var(--s1)' },
  reduced: { label: 'Reduced', color: 'var(--warn)' },
  recovery: { label: 'Recovery', color: 'var(--bad)' },
};

const SOURCE: Record<ReadinessAssessment['source'], string> = {
  oura: 'Oura',
  sliders: 'Sliders',
  blend: 'Oura + sliders',
  default: 'Default',
};

/**
 * Readiness as a ring. The number is the headline; the band word underneath
 * carries the meaning so the colour is never doing the work alone.
 */
export default function ReadinessRing({
  readiness,
  size = 104,
  showSource = true,
}: {
  readiness: ReadinessAssessment;
  size?: number;
  showSource?: boolean;
}) {
  const band = BAND[readiness.band];
  const stroke = Math.max(7, Math.round(size * 0.085));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pctValue = Math.max(0, Math.min(100, readiness.score));
  const dash = (pctValue / 100) * c;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Readiness ${Math.round(readiness.score)} out of 100 — ${band.label}`}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={band.color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.22,1,0.36,1)' }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="num-lg"
          style={{ fill: 'var(--ink)', fontSize: size * 0.32, fontWeight: 700 }}
        >
          {Math.round(readiness.score)}
        </text>
      </svg>
      <span className="mt-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: band.color }}>
        {band.label}
      </span>
      {showSource && (
        <span className="text-[0.625rem]" style={{ color: 'var(--ink-3)' }}>
          {SOURCE[readiness.source]}
        </span>
      )}
    </div>
  );
}
