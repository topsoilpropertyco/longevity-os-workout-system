'use client';

import { useState, useTransition } from 'react';
import { useToast } from './Toast';
import { setGoalMode } from '@/lib/actions';
import { GOAL_MODES, PRIMARY_GOAL_MODES, type GoalMode } from '@/lib/engine-bridge';

const LABEL: Record<GoalMode, string> = {
  maintain: 'Maintain',
  tone: 'Tone',
  bulk: 'Bulk',
  six_pack: 'Six-pack',
  strength: 'Strength',
  power: 'Power',
  endurance: 'Endurance',
  rehab: 'Rehab',
  vo2_focus: 'VO₂ focus',
  fat_loss: 'Fat loss',
};

const BLURB: Record<GoalMode, string> = {
  maintain: 'Hold everything, lose nothing. The default.',
  tone: 'Higher reps, shorter rests, more circuits.',
  bulk: 'More sets on the big patterns, longer rests.',
  six_pack: 'Core volume up, conditioning up, load steady.',
  strength: 'Low reps, heavy, long rests.',
  power: 'Plyometrics and speed first, always fresh.',
  endurance: 'Zone 2 and VO₂ lead; lifting supports.',
  rehab: 'Rehab patterns lead, load stays conservative.',
  vo2_focus: 'Two hard intervals a week, lifting maintained.',
  fat_loss: 'Density work, NEAT floor raised, protein-friendly volume.',
};

/** Four primary buttons; "More" discloses the other six (PRD §8.6). */
export default function GoalModePicker({ current }: { current: GoalMode }) {
  const [mode, setMode] = useState<GoalMode>(current);
  const [showMore, setShowMore] = useState(!PRIMARY_GOAL_MODES.includes(current));
  const [, start] = useTransition();
  const toast = useToast();

  const choose = (m: GoalMode) => {
    setMode(m);
    start(async () => {
      const res = await setGoalMode(m);
      toast(res.message ?? 'Goal mode set.', 'good');
    });
  };

  const secondary = GOAL_MODES.filter((m) => !PRIMARY_GOAL_MODES.includes(m));

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {PRIMARY_GOAL_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => choose(m)}
            className="rounded-2xl border px-3 py-3 text-left"
            style={{
              background: mode === m ? 'var(--accent)' : 'var(--surface-2)',
              color: mode === m ? 'var(--accent-ink)' : 'var(--ink)',
              borderColor: mode === m ? 'transparent' : 'var(--line)',
              minHeight: '3.5rem',
            }}
          >
            <span className="block text-base font-semibold">{LABEL[m]}</span>
            <span className="block text-[0.6875rem] leading-tight" style={{ opacity: 0.8 }}>
              {BLURB[m]}
            </span>
          </button>
        ))}
      </div>

      <button type="button" className="btn tap mt-2 w-full" onClick={() => setShowMore((s) => !s)} aria-expanded={showMore}>
        {showMore ? 'Fewer options' : 'More'}
      </button>

      {showMore && (
        <div className="animate-rise-in mt-2 grid grid-cols-2 gap-2">
          {secondary.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => choose(m)}
              className="tap rounded-xl border px-3 text-sm font-semibold"
              style={{
                background: mode === m ? 'var(--ink)' : 'transparent',
                color: mode === m ? 'var(--bg)' : 'var(--ink-2)',
                borderColor: 'var(--line)',
              }}
            >
              {LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
