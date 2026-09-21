'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import CardioCard from './CardioCard';
import ExerciseCard from './ExerciseCard';
import RestTimer from './RestTimer';
import Sheet from './Sheet';
import SwapSheet from './SwapSheet';
import { ClocksSheet } from './Clocks';
import { entriesFromPrescription, type SetEntry } from './SetTable';
import { useToast } from './Toast';
import type { PrescribedExercise, PrescribedSession, SwapCandidate } from '@/lib/engine-bridge';
import { finishSession, logSet, swapExercise } from '@/lib/actions';
import { haptic, primeAudio } from '@/lib/cues';
import { minutes, tonnage } from '@/lib/format';

type Step =
  | { kind: 'exercise'; blockTitle: string; item: PrescribedExercise }
  | { kind: 'cardio'; blockTitle: string; cardio: NonNullable<PrescribedSession['blocks'][number]['cardio']> };

type LogState = Record<string, SetEntry[]>;

function flatten(session: PrescribedSession): Step[] {
  const steps: Step[] = [];
  for (const block of session.blocks) {
    for (const item of block.exercises) steps.push({ kind: 'exercise', blockTitle: block.title, item });
    if (block.cardio) steps.push({ kind: 'cardio', blockTitle: block.title, cardio: block.cardio });
  }
  return steps;
}

/**
 * The session runtime. One exercise at a time in a horizontally snapping
 * container (the page itself never scrolls sideways), a persistent bottom bar
 * with the rest timer, progress and Finish.
 */
export default function SessionRuntime({
  session,
  swaps,
  locationName,
  nextUp,
}: {
  session: PrescribedSession;
  swaps: Record<string, SwapCandidate[]>;
  locationName: string;
  nextUp: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [liveSession, setLiveSession] = useState(session);
  const steps = useMemo(() => flatten(liveSession), [liveSession]);
  const [index, setIndex] = useState(0);
  const [logs, setLogs] = useState<LogState>({});
  const [rest, setRest] = useState<{ seconds: number; key: number } | null>(null);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [clocksOpen, setClocksOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const storageKey = `lo:session:${liveSession.date}`;

  // Seed the log state from the prescription, then hydrate anything saved.
  useEffect(() => {
    const seeded: LogState = {};
    for (const step of flatten(session)) {
      if (step.kind === 'exercise') seeded[step.item.exercise_id] = entriesFromPrescription(step.item.sets);
    }
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as LogState;
        for (const [k, v] of Object.entries(parsed)) if (seeded[k]) seeded[k] = v;
      }
    } catch {
      /* private mode — in-memory logging still works */
    }
    setLogs(seeded);
  }, [session, storageKey]);

  const persist = useCallback(
    (next: LogState) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* nothing to do */
      }
    },
    [storageKey],
  );

  const onChange = (exerciseId: string, setIndex: number, patch: Partial<SetEntry>) => {
    setLogs((prev) => {
      const rows = prev[exerciseId] ?? [];
      const nextRows = rows.map((r, i) => (i === setIndex ? { ...r, ...patch } : r));
      const next = { ...prev, [exerciseId]: nextRows };
      persist(next);
      const row = nextRows[setIndex];
      if (row && patch.done) {
        void logSet({
          sessionId: `${liveSession.date}-${liveSession.type}`,
          exerciseId,
          setIndex,
          reps: row.reps,
          loadLb: row.load_lb,
          ...(row.rpe ? { rpe: row.rpe } : {}),
          completed: true,
        });
      }
      return next;
    });
  };

  const onCompleteSet = (restS: number) => {
    primeAudio();
    haptic(30);
    if (restS > 0) setRest({ seconds: restS, key: Date.now() });
  };

  // Keep the index honest as he swipes between cards.
  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== index) setIndex(i);
  };

  const goTo = (i: number) => {
    const el = scrollerRef.current;
    const clamped = Math.max(0, Math.min(steps.length - 1, i));
    setIndex(clamped);
    el?.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
  };

  const totals = useMemo(() => {
    let done = 0;
    let all = 0;
    let volume = 0;
    for (const step of steps) {
      if (step.kind !== 'exercise') continue;
      const rows = logs[step.item.exercise_id] ?? [];
      all += step.item.sets.length;
      for (const r of rows) {
        if (r.done) {
          done += 1;
          volume += r.reps * r.load_lb;
        }
      }
    }
    return { done, all, volume };
  }, [steps, logs]);

  const currentStep = steps[index];
  const swapCandidates = swapFor ? (swaps[swapFor] ?? []) : [];
  const swapTargetName =
    liveSession.blocks.flatMap((b) => b.exercises).find((e) => e.exercise_id === swapFor)?.exercise.name ??
    'this exercise';

  const applyLocalSwap = (candidate: SwapCandidate) => {
    const originalId = swapFor;
    if (!originalId) return;
    setLiveSession((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => ({
        ...b,
        exercises: b.exercises.map((pe) =>
          pe.exercise_id === originalId
            ? {
                ...pe,
                exercise_id: candidate.exercise.id,
                exercise: candidate.exercise,
                sets: candidate.sets,
                estimated_min: candidate.estimated_min,
                why: candidate.reason,
                prediction: undefined,
              }
            : pe,
        ),
      })),
    }));
    setLogs((prev) => {
      const next = { ...prev, [candidate.exercise.id]: entriesFromPrescription(candidate.sets) };
      persist(next);
      return next;
    });
    setSwapFor(null);
    toast(`Swapped in ${candidate.exercise.name}.`, 'good');
    void swapExercise(liveSession.date, originalId, candidate.exercise.id);
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="app-pad sticky top-0 z-30 pb-2 pt-3" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => router.push('/')} className="chip tap" aria-label="Back to today">
            ← Today
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-sm font-semibold">{liveSession.title}</p>
            <p className="text-[0.6875rem]" style={{ color: 'var(--ink-3)' }}>
              {currentStep?.blockTitle ?? ''} · {locationName}
            </p>
          </div>
          <button type="button" onClick={() => setClocksOpen(true)} className="chip tap" aria-label="Open clocks">
            Clocks
          </button>
        </div>

        {/* Progress: one segment per step, so position is visible without counting. */}
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className="h-1 flex-1 rounded-full transition-colors"
              style={{ background: i <= index ? 'var(--accent)' : 'var(--surface-2)' }}
            />
          ))}
        </div>
      </header>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="scroller flex-1 items-start gap-0"
        style={{ paddingBottom: '9rem' }}
      >
        {steps.map((step, i) => (
          <div key={i} className="snap w-full px-[1.125rem]" style={{ flex: '0 0 100%' }}>
            {step.kind === 'exercise' ? (
              <ExerciseCard
                item={step.item}
                index={i}
                total={steps.length}
                entries={logs[step.item.exercise_id] ?? entriesFromPrescription(step.item.sets)}
                onChange={(setIndex, patch) => onChange(step.item.exercise_id, setIndex, patch)}
                onCompleteSet={(_setIndex, restS) => onCompleteSet(restS)}
                onSwap={() => setSwapFor(step.item.exercise_id)}
              />
            ) : (
              <CardioCard cardio={step.cardio} title={step.blockTitle} />
            )}

            <div className="mt-3 flex justify-between">
              <button type="button" className="btn tap" onClick={() => goTo(i - 1)} disabled={i === 0}>
                ← Prev
              </button>
              <button
                type="button"
                className="btn tap"
                onClick={() => goTo(i + 1)}
                disabled={i === steps.length - 1}
              >
                Next →
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Persistent bottom bar — rest, progress, finish. Thumb zone. */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t px-[1.125rem] pt-2"
        style={{
          background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderColor: 'var(--line)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.6rem)',
        }}
      >
        <div className="flex min-h-[3.25rem] items-center justify-between gap-3">
          {rest ? (
            <RestTimer
              key={rest.key}
              seconds={rest.seconds}
              variant="bar"
              onDone={() => setRest(null)}
              onDismiss={() => setRest(null)}
            />
          ) : (
            <div>
              <div className="label">Progress</div>
              <div className="num text-lg font-semibold leading-none">
                {totals.done}/{totals.all} sets
              </div>
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary tap px-6"
            onClick={() => setSummaryOpen(true)}
            disabled={pending}
          >
            Finish
          </button>
        </div>
      </div>

      <SwapSheet
        open={swapFor !== null}
        onClose={() => setSwapFor(null)}
        originalName={swapTargetName}
        locationName={locationName}
        candidates={swapCandidates}
        onPick={applyLocalSwap}
      />

      <ClocksSheet open={clocksOpen} onClose={() => setClocksOpen(false)} />

      <Sheet open={summaryOpen} onClose={() => setSummaryOpen(false)} title="Session summary">
        <div className="pb-6">
          <dl className="grid grid-cols-3 gap-2">
            {[
              { k: 'Sets', v: `${totals.done}/${totals.all}` },
              { k: 'Tonnage', v: tonnage(totals.volume) },
              { k: 'Planned', v: minutes(Math.round(liveSession.estimated_min)) },
            ].map((cell) => (
              <div key={cell.k} className="rounded-xl px-3 py-2" style={{ background: 'var(--surface-2)' }}>
                <dt className="label">{cell.k}</dt>
                <dd className="num mt-0.5 text-base font-semibold">{cell.v}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-sm" style={{ color: 'var(--ink-2)' }}>
            Next up · {nextUp}
          </p>

          <button
            type="button"
            className="btn btn-primary btn-lg mt-5"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await finishSession({
                  sessionId: `${liveSession.date}-${liveSession.type}`,
                  date: liveSession.date,
                  type: liveSession.type,
                  locationId: liveSession.location_id,
                  durationMin: liveSession.estimated_min,
                  tonnageLb: totals.volume,
                });
                toast(res.message ?? 'Logged.', 'good');
                try {
                  window.localStorage.removeItem(storageKey);
                } catch {
                  /* ignore */
                }
                router.push('/');
              })
            }
          >
            {pending ? 'Saving…' : 'Finish session'}
          </button>
          <button type="button" className="btn mt-2 w-full" onClick={() => setSummaryOpen(false)}>
            Keep going
          </button>
        </div>
      </Sheet>
    </div>
  );
}
