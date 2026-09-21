'use client';

import { useEffect, useRef, useState } from 'react';
import NumericKeypad from './NumericKeypad';
import RpeSelector from './RpeSelector';
import Sheet from './Sheet';
import type { PrescribedSet, Rpe } from '@/lib/engine-bridge';
import { haptic } from '@/lib/cues';
import { holdText, lb } from '@/lib/format';

export type SetEntry = {
  reps: number;
  load_lb: number;
  rpe?: Rpe;
  done: boolean;
};

export function entriesFromPrescription(sets: PrescribedSet[]): SetEntry[] {
  return sets.map((s) => ({ reps: s.reps, load_lb: s.load_lb, done: false }));
}

type Field = 'reps' | 'load';

/**
 * Inline set logging.
 *
 * Tapping a value CLEARS it and opens the keypad with the prescribed number as
 * a ghost — so the common case (hit what it said) is one tap on ✓, and the
 * uncommon case never makes you delete digits first.
 */
export default function SetTable({
  prescribed,
  entries,
  onChange,
  onCompleteSet,
  loadless = false,
}: {
  prescribed: PrescribedSet[];
  entries: SetEntry[];
  onChange: (index: number, patch: Partial<SetEntry>) => void;
  onCompleteSet: (index: number, restS: number) => void;
  loadless?: boolean;
}) {
  const [editing, setEditing] = useState<{ index: number; field: Field } | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft('');
      window.setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [editing]);

  const open = (index: number, field: Field) => {
    haptic(12);
    setEditing({ index, field });
  };

  const commit = () => {
    if (!editing) return;
    const value = Number(draft);
    if (draft !== '' && Number.isFinite(value)) {
      onChange(editing.index, editing.field === 'reps' ? { reps: Math.round(value) } : { load_lb: value });
    }
    setEditing(null);
  };

  const current = editing ? entries[editing.index] : undefined;
  const currentPrescribed = editing ? prescribed[editing.index] : undefined;

  // Timed work (holds, carries, backward walking) is logged by completing it,
  // not by typing a rep count, so the column header and the RPE cell change.
  const allTimed = prescribed.length > 0 && prescribed.every((p) => (p.duration_s ?? 0) > 0);

  return (
    <>
      <table className="w-full border-separate border-spacing-y-1.5 text-sm">
        <thead>
          <tr className="text-left">
            <th scope="col" className="label w-8 pl-1 font-semibold">
              Set
            </th>
            <th scope="col" className="label font-semibold">
              {allTimed ? 'Hold' : 'Reps'}
            </th>
            {!loadless && (
              <th scope="col" className="label font-semibold">
                Load
              </th>
            )}
            <th scope="col" className="label w-12 font-semibold">
              RPE
            </th>
            <th scope="col" className="label w-12 pr-1 text-right font-semibold">
              Done
            </th>
          </tr>
        </thead>
        <tbody>
          {prescribed.map((p, i) => {
            const e = entries[i] ?? { reps: p.reps, load_lb: p.load_lb, done: false };
            return (
              <tr key={i} style={{ opacity: e.done ? 0.62 : 1 }}>
                <td className="num pl-1 font-semibold" style={{ color: 'var(--ink-3)' }}>
                  {p.warmup ? 'W' : i + 1}
                </td>
                <td>
                  {p.duration_s ? (
                    // A hold is not logged by typing a number. It is done or it is
                    // not, and the clock in the runtime bar times it.
                    <div
                      className="tap flex w-full items-center rounded-xl border px-3 text-base font-semibold"
                      style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--ink-2)' }}
                    >
                      <span className="num">{holdText(p.duration_s)}</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => open(i, 'reps')}
                      className="tap w-full rounded-xl border px-3 text-left text-base font-semibold"
                      style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
                    >
                      <span className="num">{e.reps}</span>
                    </button>
                  )}
                </td>
                {!loadless && (
                  <td>
                    <button
                      type="button"
                      onClick={() => open(i, 'load')}
                      className="tap w-full rounded-xl border px-3 text-left text-base font-semibold"
                      style={{ background: 'var(--surface-2)', borderColor: 'var(--line)' }}
                    >
                      <span className="num">{e.load_lb > 0 ? lb(e.load_lb, { compact: true }) : '—'}</span>
                    </button>
                  </td>
                )}
                <td>
                  {p.duration_s ? (
                    <div
                      className="tap flex w-full items-center justify-center rounded-xl border text-center text-sm"
                      style={{ borderColor: 'transparent', color: 'var(--ink-3)' }}
                      aria-hidden="true"
                    >
                      —
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => open(i, 'reps')}
                      className="tap w-full rounded-xl border text-center text-sm"
                      style={{ background: 'transparent', borderColor: 'var(--line)', color: 'var(--ink-3)' }}
                      aria-label={`RPE for set ${i + 1}`}
                    >
                      <span className="num">{e.rpe ?? (p.rpe_target ? `·${p.rpe_target}` : '—')}</span>
                    </button>
                  )}
                </td>
                <td className="pr-1 text-right">
                  <button
                    type="button"
                    aria-pressed={e.done}
                    aria-label={`Mark set ${i + 1} complete`}
                    onClick={() => {
                      haptic(e.done ? 8 : 25);
                      onChange(i, { done: !e.done });
                      if (!e.done) onCompleteSet(i, p.rest_s);
                    }}
                    className="tap ml-auto flex w-11 items-center justify-center rounded-xl border"
                    style={{
                      background: e.done ? 'var(--good)' : 'var(--surface-2)',
                      borderColor: e.done ? 'transparent' : 'var(--line)',
                      color: e.done ? 'var(--bg)' : 'var(--ink-3)',
                    }}
                  >
                    ✓
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Sheet
        open={editing !== null}
        onClose={commit}
        title={editing ? `Set ${editing.index + 1} · ${editing.field === 'reps' ? 'reps' : 'load'}` : ''}
        subtitle={
          currentPrescribed
            ? `Prescribed ${currentPrescribed.reps} reps${currentPrescribed.load_lb > 0 ? ` × ${lb(currentPrescribed.load_lb)} total` : ''}`
            : undefined
        }
      >
        <div className="pb-4">
          <div className="mb-3 flex items-end gap-2">
            <input
              ref={inputRef}
              inputMode="decimal"
              enterKeyHint="done"
              value={draft}
              placeholder={String(
                editing?.field === 'reps' ? (currentPrescribed?.reps ?? '') : (currentPrescribed?.load_lb ?? ''),
              )}
              onChange={(ev) => setDraft(ev.target.value.replace(/[^0-9.]/g, ''))}
              onFocus={(ev) => ev.currentTarget.select()}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') commit();
              }}
              className="num-lg w-full rounded-2xl border bg-transparent px-4 py-3 text-4xl outline-none"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              aria-label={editing?.field === 'reps' ? 'Reps' : 'Total load in pounds'}
            />
            <span className="pb-4 text-sm font-semibold" style={{ color: 'var(--ink-3)' }}>
              {editing?.field === 'reps' ? 'reps' : 'lb total'}
            </span>
          </div>

          {editing?.field === 'load' && (
            <p className="mb-3 text-xs" style={{ color: 'var(--ink-3)' }}>
              Total load — both dumbbells summed, bar weight included.
            </p>
          )}

          <NumericKeypad
            onKey={(k) => {
              inputRef.current?.blur();
              setDraft((d) => {
                if (k === '⌫') return d.slice(0, -1);
                if (k === '.' && d.includes('.')) return d;
                return (d + k).slice(0, 6);
              });
            }}
            onDone={commit}
            doneLabel="Save"
          />

          <div className="mt-5">
            <RpeSelector
              value={current?.rpe}
              onChange={(v) => {
                if (editing) onChange(editing.index, v === undefined ? { rpe: undefined } : { rpe: v });
              }}
            />
          </div>
        </div>
      </Sheet>
    </>
  );
}
