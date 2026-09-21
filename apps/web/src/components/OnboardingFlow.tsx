'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from './Toast';
import { markOnboarded, setGoalMode, setLocation } from '@/lib/actions';
import { PRIMARY_GOAL_MODES, type GoalMode, type GymLocation } from '@/lib/engine-bridge';

type Draft = {
  name: string;
  heightIn: number;
  bodyweight: number;
  birthDate: string;
  mode: GoalMode;
  locationId: string;
  knees: boolean;
  back: boolean;
  vertical: string;
};

const STEPS = ['You', 'Body', 'Goal', 'Home', 'Injuries', 'Vertical'] as const;

/**
 * First run. Six short screens, one question each, all of them skippable except
 * the ones the engine genuinely cannot guess.
 */
export default function OnboardingFlow({ locations }: { locations: GymLocation[] }) {
  const router = useRouter();
  const toast = useToast();
  const [, start] = useTransition();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    name: 'Seth',
    heightIn: 75,
    bodyweight: 214,
    birthDate: '1992-03-14',
    mode: 'maintain',
    locationId: locations[0]?.id ?? 'loc-home',
    knees: true,
    back: true,
    vertical: '',
  });

  const field = 'tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base';
  const fieldStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

  const finish = () => {
    start(async () => {
      await setGoalMode(draft.mode);
      await setLocation(draft.locationId);
      await markOnboarded();
      // TODO(db): write athlete, body metric and injury rows through @longevity/db.
      toast('You’re set. Tomorrow it just knows.', 'good');
      router.push('/');
    });
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="app-pad pt-6">
        <div className="flex gap-1" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? 'var(--accent)' : 'var(--surface-2)' }} />
          ))}
        </div>
        <p className="label mt-3">
          Step {step + 1} of {STEPS.length}
        </p>
      </header>

      <div className="app-pad flex-1 pb-40 pt-2">
        {step === 0 && (
          <section className="animate-rise-in">
            <h1 className="text-[2rem] leading-tight">What should the app call you?</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              One athlete for now. Everything is stored under your own user id from day one.
            </p>
            <label className="mt-6 block">
              <span className="label">Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={field} style={fieldStyle} />
            </label>
          </section>
        )}

        {step === 1 && (
          <section className="animate-rise-in">
            <h1 className="text-[2rem] leading-tight">The three numbers the engine needs.</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              Height and bodyweight set the %BW standards; the birth date only feeds the HRmax fallback.
            </p>
            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="label">Height (inches)</span>
                <input inputMode="decimal" value={draft.heightIn} onChange={(e) => setDraft({ ...draft, heightIn: Number(e.target.value) || 0 })} className={`num ${field}`} style={fieldStyle} />
              </label>
              <label className="block">
                <span className="label">Bodyweight (lb)</span>
                <input inputMode="decimal" value={draft.bodyweight} onChange={(e) => setDraft({ ...draft, bodyweight: Number(e.target.value) || 0 })} className={`num ${field}`} style={fieldStyle} />
              </label>
              <label className="block">
                <span className="label">Birth date</span>
                <input type="date" value={draft.birthDate} onChange={(e) => setDraft({ ...draft, birthDate: e.target.value })} className={field} style={fieldStyle} />
              </label>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="animate-rise-in">
            <h1 className="text-[2rem] leading-tight">What are we optimising for?</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              Longevity is always the floor. This just tilts the week — you can change it any day.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2">
              {PRIMARY_GOAL_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDraft({ ...draft, mode: m })}
                  aria-pressed={draft.mode === m}
                  className="rounded-2xl border px-3 py-4 text-base font-semibold capitalize"
                  style={{
                    background: draft.mode === m ? 'var(--accent)' : 'var(--surface-2)',
                    color: draft.mode === m ? 'var(--accent-ink)' : 'var(--ink)',
                    borderColor: draft.mode === m ? 'transparent' : 'var(--line)',
                  }}
                >
                  {m.replace('_', ' ')}
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="animate-rise-in">
            <h1 className="text-[2rem] leading-tight">Where do you train most days?</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              This becomes the sticky default. Switching takes one tap on the today card.
            </p>
            <ul className="mt-6 space-y-2">
              {locations.map((loc) => (
                <li key={loc.id}>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, locationId: loc.id })}
                    aria-pressed={draft.locationId === loc.id}
                    className="card w-full p-4 text-left"
                    style={{ borderColor: draft.locationId === loc.id ? 'var(--accent)' : 'var(--line)' }}
                  >
                    <span className="block font-semibold">{loc.name}</span>
                    <span className="block text-xs" style={{ color: 'var(--ink-3)' }}>
                      {loc.equipment.filter((e) => e.available).length} items
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {step === 4 && (
          <section className="animate-rise-in">
            <h1 className="text-[2rem] leading-tight">Anything hurting?</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              These become hard constraints. They never disappear on their own — you resolve them.
            </p>
            <div className="mt-6 space-y-2">
              {[
                { key: 'knees' as const, label: 'Knees', note: 'Routes to Knees Over Toes, ground-up' },
                { key: 'back' as const, label: 'Low back', note: 'McGill Big 3 daily, no loaded flexion' },
              ].map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => setDraft({ ...draft, [row.key]: !draft[row.key] })}
                  aria-pressed={draft[row.key]}
                  className="card flex w-full items-center justify-between p-4 text-left"
                  style={{ borderColor: draft[row.key] ? 'var(--accent)' : 'var(--line)' }}
                >
                  <span>
                    <span className="block font-semibold">{row.label}</span>
                    <span className="block text-xs" style={{ color: 'var(--ink-3)' }}>
                      {row.note}
                    </span>
                  </span>
                  <span className="text-lg">{draft[row.key] ? '✓' : '+'}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 5 && (
          <section className="animate-rise-in">
            <h1 className="text-[2rem] leading-tight">Vertical baseline.</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
              Chalk on your fingers, mark your standing reach, jump and mark again. The difference is the number. Ten
              minutes now, retested every eight weeks.
            </p>
            <label className="mt-6 block">
              <span className="label">Vertical (inches) — optional</span>
              <input
                inputMode="decimal"
                value={draft.vertical}
                onChange={(e) => setDraft({ ...draft, vertical: e.target.value })}
                placeholder="24.5"
                className={`num ${field}`}
                style={fieldStyle}
              />
            </label>
            <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>
              Skip it and the bot will ask you on the first power day.
            </p>
          </section>
        )}
      </div>

      <div className="thumb-bar">
        <div className="mx-auto flex max-w-xl gap-2">
          {step > 0 && (
            <button type="button" className="btn tap px-5" onClick={() => setStep((s) => s - 1)}>
              Back
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => (step === STEPS.length - 1 ? finish() : setStep((s) => s + 1))}
          >
            {step === STEPS.length - 1 ? 'Start training' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
