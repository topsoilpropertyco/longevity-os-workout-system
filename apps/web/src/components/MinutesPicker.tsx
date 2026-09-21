'use client';

import { useTransition } from 'react';
import { TIME_BUDGETS } from '@/lib/engine-bridge';

/** The six budgets from PRD §8.1. One tap, no keyboard, no thinking. */
export default function MinutesPicker({
  value,
  onSelect,
  compact = false,
}: {
  value: number;
  onSelect: (minutes: number) => void | Promise<unknown>;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className={`scroller gap-2 ${pending ? 'opacity-60' : ''}`} role="group" aria-label="Minutes available">
      {TIME_BUDGETS.map((m) => {
        const active = m === value;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={active}
            onClick={() => start(() => void onSelect(m))}
            className="snap tap rounded-full border px-4 text-sm font-semibold transition-colors"
            style={{
              background: active ? 'var(--ink)' : 'var(--surface)',
              color: active ? 'var(--bg)' : 'var(--ink-2)',
              borderColor: active ? 'transparent' : 'var(--line)',
            }}
          >
            {m}
            {compact ? '' : ' min'}
          </button>
        );
      })}
    </div>
  );
}
