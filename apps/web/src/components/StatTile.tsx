/**
 * Dashboard tile. Fixed 128px body so the grid never reflows when the numbers
 * arrive, and the delta always states its direction in words as well as colour.
 */
export default function StatTile({
  label,
  value,
  unit,
  sub,
  delta,
  deltaGood,
  chart,
  href,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  delta?: string;
  deltaGood?: boolean;
  chart?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <div className="card flex h-full flex-col justify-between p-4" style={{ minHeight: 128 }}>
      <div className="flex items-start justify-between gap-2">
        <span className="label">{label}</span>
        {delta && (
          <span
            className="num text-[0.6875rem] font-bold"
            style={{ color: deltaGood === undefined ? 'var(--ink-3)' : deltaGood ? 'var(--good)' : 'var(--bad)' }}
          >
            {delta}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="num-lg text-[1.75rem] leading-none">{value}</span>
        {unit && (
          <span className="text-xs font-semibold" style={{ color: 'var(--ink-3)' }}>
            {unit}
          </span>
        )}
      </div>
      {chart && <div className="mt-2">{chart}</div>}
      {sub && (
        <p className="mt-2 text-xs leading-tight" style={{ color: 'var(--ink-3)' }}>
          {sub}
        </p>
      )}
    </div>
  );

  if (!href) return body;
  return (
    <a href={href} className="block">
      {body}
    </a>
  );
}
