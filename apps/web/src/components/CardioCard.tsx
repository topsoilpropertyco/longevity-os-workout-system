'use client';

import { useState, useTransition } from 'react';
import Sheet from './Sheet';
import WhyLine from './WhyLine';
import { ClockInterval } from './Clocks';
import { useToast } from './Toast';
import type { CardioPrescription } from '@/lib/engine-bridge';
import { logCardioManual } from '@/lib/actions';
import { bpmRange, minutes } from '@/lib/format';

const STRUCTURE_LABEL: Record<CardioPrescription['structure'], string> = {
  steady: 'Steady',
  intervals: 'Intervals',
  walk_run: 'Walk / run',
  sprints: 'Sprints',
  ruck: 'Ruck',
};

/** Deep-link to the Strava app, falling back to the web without a dead tab. */
function openStrava() {
  const started = Date.now();
  const timer = window.setTimeout(() => {
    if (Date.now() - started < 1600) window.location.href = 'https://www.strava.com/dashboard';
  }, 900);
  window.location.href = 'strava://';
  window.addEventListener('pagehide', () => window.clearTimeout(timer), { once: true });
}

export default function CardioCard({ cardio, title }: { cardio: CardioPrescription; title: string }) {
  const [manualOpen, setManualOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <article className="card overflow-hidden">
      <div className="p-4">
        <span className="label">{title}</span>
        <h2 className="mt-1 text-[1.5rem] leading-tight capitalize">
          {cardio.modality} · {STRUCTURE_LABEL[cardio.structure]}
        </h2>

        <dl className="mt-3 grid grid-cols-3 gap-2">
          {[
            { k: 'Duration', v: minutes(cardio.duration_min) },
            { k: 'Target', v: bpmRange(cardio.target_bpm) },
            { k: 'Zone', v: cardio.target_zone.toUpperCase() },
          ].map((cell) => (
            <div key={cell.k} className="rounded-xl px-3 py-2" style={{ background: 'var(--surface-2)' }}>
              <dt className="label">{cell.k}</dt>
              <dd className="num mt-0.5 text-sm font-semibold">{cell.v}</dd>
            </div>
          ))}
        </dl>

        {cardio.intervals && (
          <p className="num mt-3 rounded-xl px-3 py-2 text-sm" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
            {cardio.intervals.rounds} × ({cardio.intervals.work_min} min @ {bpmRange(cardio.intervals.work_bpm)} /{' '}
            {cardio.intervals.rest_min} min easy)
          </p>
        )}

        <div className="mt-3">
          <WhyLine>{cardio.why}</WhyLine>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="btn tap" onClick={openStrava}>
            Open Strava
          </button>
          {cardio.structure === 'intervals' ? (
            <button type="button" className="btn tap" onClick={() => setClockOpen(true)}>
              Interval clock
            </button>
          ) : (
            <button type="button" className="btn tap" onClick={() => setManualOpen(true)}>
              Log manually
            </button>
          )}
        </div>
        {cardio.structure === 'intervals' && (
          <button type="button" className="btn tap mt-2 w-full" onClick={() => setManualOpen(true)}>
            Log manually
          </button>
        )}
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-3)' }}>
          Strava fills this in automatically when the activity lands. Manual entry never blocks — any one field is enough.
        </p>
      </div>

      <Sheet open={clockOpen} onClose={() => setClockOpen(false)} title="Interval clock">
        <div className="pb-6">
          <ClockInterval
            workS={(cardio.intervals?.work_min ?? 4) * 60}
            restS={(cardio.intervals?.rest_min ?? 3) * 60}
            rounds={cardio.intervals?.rounds ?? 4}
          />
        </div>
      </Sheet>

      <Sheet
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Log it manually"
        subtitle="Any single field is enough. Fill in what you know."
      >
        <form
          className="space-y-3 pb-6"
          action={(formData: FormData) => {
            const num = (k: string) => {
              const raw = formData.get(k);
              const n = Number(raw);
              return raw && Number.isFinite(n) ? n : undefined;
            };
            start(async () => {
              const res = await logCardioManual({
                modality: String(formData.get('modality') ?? cardio.modality),
                durationMin: num('duration'),
                distanceMi: num('distance'),
                avgHr: num('avg_hr'),
                rpe: num('rpe'),
                note: String(formData.get('note') ?? ''),
              });
              toast(res.message ?? 'Logged.', res.ok ? 'good' : 'bad');
              setManualOpen(false);
            });
          }}
        >
          <label className="block">
            <span className="label">Type</span>
            <select
              name="modality"
              defaultValue={cardio.modality}
              className="tap mt-1 w-full rounded-xl border px-3"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              {['run', 'walk', 'ruck', 'bike', 'row', 'ski_erg', 'elliptical', 'stair', 'swim', 'other'].map((m) => (
                <option key={m} value={m}>
                  {m.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            {[
              { name: 'duration', label: 'Minutes' },
              { name: 'distance', label: 'Miles' },
              { name: 'avg_hr', label: 'Avg HR' },
              { name: 'rpe', label: 'RPE 1–10' },
            ].map((f) => (
              <label key={f.name} className="block">
                <span className="label">{f.label}</span>
                <input
                  name={f.name}
                  inputMode="decimal"
                  className="num tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                />
              </label>
            ))}
          </div>

          <label className="block">
            <span className="label">Note</span>
            <input
              name="note"
              className="tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base"
              style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              placeholder="Felt easy, windy out"
            />
          </label>

          <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>
            {pending ? 'Logging…' : 'Log it'}
          </button>
        </form>
      </Sheet>
    </article>
  );
}
