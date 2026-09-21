'use client';

import { haptic } from '@/lib/cues';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as const;

/**
 * In-app keypad. Big, thumb-reachable keys so the iOS system keyboard never has
 * to cover the set table. `onPointerDown` is prevented so the focused input
 * keeps focus (and the caret) while these are tapped.
 */
export default function NumericKeypad({
  onKey,
  onDone,
  doneLabel = 'Done',
}: {
  onKey: (key: string) => void;
  onDone: () => void;
  doneLabel?: string;
}) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              haptic(10);
              onKey(k);
            }}
            className="rounded-2xl border text-xl font-semibold"
            style={{
              minHeight: '3.5rem',
              background: k === '⌫' ? 'var(--surface-2)' : 'var(--surface)',
              borderColor: 'var(--line)',
            }}
            aria-label={k === '⌫' ? 'Delete' : k}
          >
            {k}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-primary btn-lg mt-2" onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}
