'use client';

import { useState, useTransition } from 'react';
import PainSlider from './PainSlider';
import Sheet from './Sheet';
import { useToast } from './Toast';
import { resolveInjury, updateInjuryPain } from '@/lib/actions';
import { REGIONS, type Injury, type Pain0to10, type Region } from '@/lib/engine-bridge';
import { ago } from '@/lib/format';

function regionLabel(r: Region) {
  return r.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Injuries never disappear silently — only an explicit Resolve closes one. */
export default function InjuryRegister({ injuries, todayIso }: { injuries: Injury[]; todayIso: string }) {
  const toast = useToast();
  const [, start] = useTransition();
  const [list, setList] = useState(injuries);
  const [confirming, setConfirming] = useState<Injury | null>(null);
  const [adding, setAdding] = useState(false);

  const setPain = (id: string, pain: Pain0to10) => {
    setList((prev) => prev.map((i) => (i.id === id ? { ...i, current_pain: pain } : i)));
    start(async () => {
      await updateInjuryPain(id, pain);
    });
  };

  return (
    <>
      <ul className="space-y-3">
        {list.map((injury) => (
          <li key={injury.id} className="card p-4" style={{ opacity: injury.resolved_on ? 0.55 : 1 }}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <span className="label">{regionLabel(injury.region)}</span>
                <h2 className="text-lg leading-tight">{injury.label}</h2>
              </div>
              <span className="shrink-0 text-[0.625rem] font-bold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
                {injury.kind === 'longstanding' ? 'Longstanding' : 'Recent'}
              </span>
            </div>

            <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
              Onset {ago(injury.onset, todayIso)}
              {injury.resolved_on ? ` · resolved ${ago(injury.resolved_on, todayIso)}` : ''}
            </p>

            {!injury.resolved_on && (
              <div className="mt-3">
                <PainSlider value={injury.current_pain} onChange={(v) => setPain(injury.id, v)} />
              </div>
            )}

            {injury.aggravators.length > 0 && (
              <div className="mt-3">
                <span className="label">Aggravators</span>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {injury.aggravators.map((a) => (
                    <li key={a} className="chip" style={{ minHeight: '1.75rem' }}>
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {injury.notes && (
              <p className="mt-3 text-sm" style={{ color: 'var(--ink-2)' }}>
                {injury.notes}
              </p>
            )}

            {!injury.resolved_on && (
              <button type="button" className="btn tap mt-3 w-full" onClick={() => setConfirming(injury)}>
                Resolve
              </button>
            )}
          </li>
        ))}
      </ul>

      <button type="button" className="btn btn-primary btn-lg mt-4" onClick={() => setAdding(true)}>
        Add an injury
      </button>

      <Sheet
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Resolve this injury?"
        subtitle="It stays in the register, closed — nothing is deleted."
      >
        <div className="pb-6">
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            {confirming?.label}. The engine will stop routing around it and will reintroduce the pattern gradually.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-lg mt-4"
            onClick={() => {
              const id = confirming?.id;
              if (!id) return;
              setList((prev) => prev.map((i) => (i.id === id ? { ...i, resolved_on: todayIso } : i)));
              start(async () => {
                const res = await resolveInjury(id);
                toast(res.message ?? 'Resolved.', 'good');
              });
              setConfirming(null);
            }}
          >
            Yes, resolve it
          </button>
          <button type="button" className="btn mt-2 w-full" onClick={() => setConfirming(null)}>
            Keep it open
          </button>
        </div>
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="New injury" maxHeight="90%">
        <form
          className="space-y-4 pb-8"
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const region = String(data.get('region') ?? 'low_back') as Region;
            const injury: Injury = {
              id: `inj-${Date.now()}`,
              region,
              label: String(data.get('label') ?? regionLabel(region)),
              onset: String(data.get('onset') ?? todayIso),
              kind: (String(data.get('kind') ?? 'recent') as Injury['kind']),
              current_pain: Number(data.get('pain') ?? 3) as Pain0to10,
              aggravators: String(data.get('aggravators') ?? '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
              notes: String(data.get('notes') ?? ''),
            };
            setList((prev) => [...prev, injury]);
            // TODO(db): insert into `injuries` via @longevity/db.
            toast('Added to the register.', 'good');
            setAdding(false);
          }}
        >
          <label className="block">
            <span className="label">Region</span>
            <select
              name="region"
              className="tap mt-1 w-full rounded-xl border px-3"
              style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {regionLabel(r)}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label">Label</span>
            <input name="label" className="tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} placeholder="Right shoulder — front" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="label">Onset</span>
              <input name="onset" type="date" defaultValue={todayIso} className="tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} />
            </label>
            <label className="block">
              <span className="label">Type</span>
              <select name="kind" className="tap mt-1 w-full rounded-xl border px-3" style={{ background: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--ink)' }}>
                <option value="recent">Recent</option>
                <option value="longstanding">Longstanding</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="label">Current pain (0–10)</span>
            <input name="pain" inputMode="decimal" defaultValue="3" className="num tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} />
          </label>

          <label className="block">
            <span className="label">Aggravators (comma separated)</span>
            <input name="aggravators" className="tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} placeholder="Overhead pressing, sleeping on it" />
          </label>

          <label className="block">
            <span className="label">Notes</span>
            <input name="notes" className="tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base" style={{ borderColor: 'var(--line)', color: 'var(--ink)' }} />
          </label>

          <button type="submit" className="btn btn-primary btn-lg">
            Add to register
          </button>
        </form>
      </Sheet>
    </>
  );
}
