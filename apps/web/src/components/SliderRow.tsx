'use client';

import type { Slider1to5 } from '@/lib/engine-bridge';

/**
 * A 1–5 self-report as five tappable pills. No drag, no precision, no thinking:
 * five targets, each ≥44 px, with the ends labelled in plain words.
 */
export default function SliderRow({
  label,
  value,
  onChange,
  lowLabel,
  highLabel,
  hint,
}: {
  label: string;
  value: Slider1to5 | undefined;
  onChange: (v: Slider1to5) => void;
  lowLabel: string;
  highLabel: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        {hint && (
          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
            {hint}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-5 gap-1.5" role="group" aria-label={label}>
        {([1, 2, 3, 4, 5] as Slider1to5[]).map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              aria-pressed={active}
              aria-label={`${label} ${n} of 5`}
              onClick={() => onChange(n)}
              className="tap rounded-xl border text-base font-semibold transition-colors"
              style={{
                background: active ? 'var(--accent)' : 'var(--surface-2)',
                color: active ? 'var(--accent-ink)' : 'var(--ink-2)',
                borderColor: active ? 'transparent' : 'var(--line)',
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[0.6875rem]" style={{ color: 'var(--ink-3)' }}>
        <span>{lowLabel}</span>
        <span>{highLabel}</span>
      </div>
    </div>
  );
}
