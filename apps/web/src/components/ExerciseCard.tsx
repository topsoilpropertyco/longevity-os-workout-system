'use client';

import ExerciseMedia from './ExerciseMedia';
import PredictionBand from './PredictionBand';
import SetTable, { type SetEntry } from './SetTable';
import WhyLine from './WhyLine';
import type { PrescribedExercise } from '@/lib/engine-bridge';
import { setsRepsLoad } from '@/lib/format';

export default function ExerciseCard({
  item,
  entries,
  index,
  total,
  onChange,
  onCompleteSet,
  onSwap,
}: {
  item: PrescribedExercise;
  entries: SetEntry[];
  index: number;
  total: number;
  onChange: (setIndex: number, patch: Partial<SetEntry>) => void;
  onCompleteSet: (setIndex: number, restS: number) => void;
  onSwap: () => void;
}) {
  const loadless = (item.sets[0]?.load_lb ?? 0) <= 0;

  return (
    <article className="card overflow-hidden">
      <div className="p-4 pb-0">
        <div className="flex items-center justify-between">
          <span className="label">
            Exercise {index + 1} of {total}
          </span>
          <button type="button" onClick={onSwap} className="chip tap" aria-haspopup="dialog">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M4 8h13l-3-3M20 16H7l3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Swap
          </button>
        </div>
        <h2 className="mt-1.5 text-[1.5rem] leading-tight">{item.exercise.name}</h2>
        <p className="num mt-0.5 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
          {setsRepsLoad(item.sets)}
          {loadless ? '' : ' total'}
        </p>
      </div>

      <div className="px-4 pt-3">
        <ExerciseMedia exercise={item.exercise} />
      </div>

      <div className="space-y-4 p-4">
        <WhyLine>{item.why}</WhyLine>

        {item.exercise.cue && (
          <p className="rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
              Cue ·{' '}
            </span>
            {item.exercise.cue}
          </p>
        )}

        {/* A prediction band on a bodyweight move would be three zeroes. */}
        {item.prediction && item.prediction.probable > 0 && (
          <PredictionBand band={item.prediction} reps={item.sets[0]?.reps} />
        )}

        <SetTable
          prescribed={item.sets}
          entries={entries}
          onChange={onChange}
          onCompleteSet={onCompleteSet}
          loadless={loadless}
        />
      </div>
    </article>
  );
}
