import type { SwapDifficulty } from '@/lib/engine-bridge';

const MAP: Record<SwapDifficulty, { label: string; color: string; glyph: string }> = {
  easier: { label: 'Easier', color: 'var(--s1)', glyph: '↓' },
  same: { label: 'Same', color: 'var(--ink-2)', glyph: '=' },
  harder: { label: 'Harder', color: 'var(--s2)', glyph: '↑' },
};

/** Colour never carries the meaning alone — the word and the glyph do too. */
export default function DifficultyChip({ difficulty }: { difficulty: SwapDifficulty }) {
  const m = MAP[difficulty];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide"
      style={{ color: m.color, background: 'color-mix(in srgb, currentColor 12%, transparent)' }}
    >
      <span aria-hidden="true">{m.glyph}</span>
      {m.label}
    </span>
  );
}
