'use client';

import type { Rpe } from '@/lib/engine-bridge';

/** Optional RPE, 1–10, as a scrollable row of ≥44 px buttons. */
export default function RpeSelector({
  value,
  onChange,
  compact = false,
}: {
  value?: Rpe;
  onChange: (v: Rpe | undefined) => void;
  compact?: boolean;
}) {
  return (
    <div>
      {!compact && (
        <div className="flex items-baseline justify-between">
          <span className="label">RPE — optional</span>
          {value !== undefined && (
            <button type="button" className="text-xs underline" style={{ color: 'var(--ink-3)' }} onClick={() => onChange(undefined)}>
              Clear
            </button>
          )}
        </div>
      )}
      <div className="scroller mt-2 gap-1.5 pb-1" role="group" aria-label="Rate of perceived exertion">
        {Array.from({ length: 10 }, (_, i) => (i + 1) as Rpe).map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active ? undefined : n)}
              className="snap tap min-w-tap rounded-xl border text-sm font-semibold"
              style={{
                background: active ? 'var(--ink)' : 'var(--surface-2)',
                color: active ? 'var(--bg)' : 'var(--ink-2)',
                borderColor: active ? 'transparent' : 'var(--line)',
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
