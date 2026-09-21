'use client';

import DifficultyChip from './DifficultyChip';
import ExerciseMedia from './ExerciseMedia';
import Sheet from './Sheet';
import type { SwapCandidate } from '@/lib/engine-bridge';
import { setsRepsLoad } from '@/lib/format';

/**
 * The swap carousel. Thumbnails first so it is instant on LTE; one tap replaces
 * the exercise and the engine re-times the session.
 */
export default function SwapSheet({
  open,
  onClose,
  originalName,
  locationName,
  candidates,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  originalName: string;
  locationName: string;
  candidates: SwapCandidate[];
  onPick: (candidate: SwapCandidate) => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`Swap ${originalName}`}
      subtitle={`Filtered to what's at ${locationName}, ranked by pattern and region match.`}
    >
      {candidates.length === 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
          Nothing at this location matches the pattern closely enough to swap safely.
        </p>
      ) : (
        <div className="scroller -mx-5 gap-3 px-5 pb-6">
          {candidates.map((c) => (
            <button
              key={c.exercise.id}
              type="button"
              onClick={() => onPick(c)}
              className="snap card w-[15rem] overflow-hidden p-3 text-left"
            >
              <ExerciseMedia exercise={c.exercise} ratio="16 / 10" rounded="0.75rem" thumb />
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <DifficultyChip difficulty={c.difficulty} />
                <span className="num text-[0.625rem]" style={{ color: 'var(--ink-3)' }}>
                  {Math.round(c.score * 100)}% match
                </span>
              </div>
              <h3 className="mt-1.5 text-base leading-tight">{c.exercise.name}</h3>
              <p className="num mt-0.5 text-xs" style={{ color: 'var(--ink-2)' }}>
                {setsRepsLoad(c.sets)} · ~{c.estimated_min} min
              </p>
              <p className="mt-1.5 text-xs leading-snug" style={{ color: 'var(--ink-3)' }}>
                {c.reason}
              </p>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
