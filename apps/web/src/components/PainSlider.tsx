'use client';

import type { Pain0to10 } from '@/lib/engine-bridge';

/** 0–10 pain, eleven targets, colour plus number so it never reads by hue alone. */
export default function PainSlider({
  value,
  onChange,
  label = 'Current pain',
}: {
  value: Pain0to10;
  onChange: (v: Pain0to10) => void;
  label?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="num text-sm" style={{ color: 'var(--ink-2)' }}>
          {value} / 10
        </span>
      </div>
      <div className="scroller mt-2 gap-1.5 pb-1" role="group" aria-label={label}>
        {Array.from({ length: 11 }, (_, n) => {
          const active = value === n;
          const tone = n <= 2 ? 'var(--good)' : n <= 5 ? 'var(--warn)' : 'var(--bad)';
          return (
            <button
              key={n}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(n as Pain0to10)}
              className="snap tap min-w-tap rounded-xl border text-sm font-semibold"
              style={{
                background: active ? tone : 'var(--surface-2)',
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
