import TrendChart, { type TrendSeries } from './TrendChart';

/**
 * Readiness vs performance. Two measures of different scale on ONE axis: both
 * are indexed to their own 28-day mean (100 = typical), which is the honest way
 * to overlay them — a second y-axis would not be.
 */
export default function OverlayChart({
  labels,
  readiness,
  performance,
}: {
  labels: string[];
  readiness: number[];
  performance: number[];
}) {
  const index = (values: number[]): number[] => {
    const mean = values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
    return values.map((v) => Math.round((v / (mean || 1)) * 100));
  };

  const series: TrendSeries[] = [
    { label: 'Readiness (index)', color: 'var(--s1)', points: labels.map((x, i) => ({ x, y: index(readiness)[i] ?? 100 })) },
    {
      label: 'Session tonnage (index)',
      color: 'var(--s2)',
      points: labels.map((x, i) => ({ x, y: index(performance)[i] ?? 100 })),
      dashed: true,
    },
  ];

  return (
    <div>
      <TrendChart series={series} title="Readiness vs performance" yUnit="100 = your own average" />
      <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
        Both lines are indexed to their 28-day mean so they share one scale.
      </p>
    </div>
  );
}
