'use client';

import { useState } from 'react';
import EquipmentChecklist from './EquipmentChecklist';
import Sheet from './Sheet';
import { useToast } from './Toast';
import type { GymLocation } from '@/lib/engine-bridge';
import { lb } from '@/lib/format';

type Preset = { key: string; name: string; note: string; template: GymLocation };

/**
 * Locations are a checklist over the equipment catalog, plus the two numbers
 * that change what a lift weighs: the straight bar and the Smith bar.
 */
export default function LocationEditor({
  initial,
  presets,
}: {
  initial: GymLocation[];
  presets: Preset[];
}) {
  const toast = useToast();
  const [locations, setLocations] = useState(initial);
  const [editing, setEditing] = useState<GymLocation | null>(null);
  const [adding, setAdding] = useState(false);

  const save = (loc: GymLocation) => {
    setLocations((prev) => (prev.some((l) => l.id === loc.id) ? prev.map((l) => (l.id === loc.id ? loc : l)) : [...prev, loc]));
    setEditing(null);
    // TODO(db): persist through `@longevity/db` (locations + location_equipment).
    toast(`${loc.name} saved.`, 'good');
  };

  const clone = (preset: Preset) => {
    const copy: GymLocation = {
      ...preset.template,
      id: `loc-${preset.key}-${Date.now()}`,
      name: preset.name.replace(' — standard', '').replace(' — typical', ''),
      equipment: preset.template.equipment.map((e) => ({ ...e })),
    };
    setAdding(false);
    setEditing(copy);
  };

  return (
    <>
      <ul className="space-y-3">
        {locations.map((loc) => {
          const count = loc.equipment.filter((e) => e.available).length;
          return (
            <li key={loc.id}>
              <button type="button" onClick={() => setEditing(loc)} className="card w-full p-4 text-left">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-lg font-semibold">{loc.name}</span>
                  <span className="num text-xs" style={{ color: 'var(--ink-3)' }}>
                    {count} items
                  </span>
                </div>
                <p className="num mt-1 text-xs" style={{ color: 'var(--ink-2)' }}>
                  Bar {lb(loc.bar_weight_lb)} · Smith {lb(loc.smith_bar_weight_lb)}
                  {loc.overhead_min ? ` · ${loc.overhead_min} min travel` : ''}
                </p>
              </button>
            </li>
          );
        })}
      </ul>

      <button type="button" className="btn btn-primary btn-lg mt-4" onClick={() => setAdding(true)}>
        New location
      </button>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Start from a preset" subtitle="Clone it, then edit what's different at your club.">
        <ul className="divide-line pb-6">
          {presets.map((p) => (
            <li key={p.key}>
              <button type="button" onClick={() => clone(p)} className="w-full py-4 text-left">
                <span className="block font-semibold">{p.name}</span>
                <span className="block text-xs" style={{ color: 'var(--ink-3)' }}>
                  {p.note}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing?.name ?? ''} maxHeight="92%">
        {editing && (
          <div className="space-y-4 pb-8">
            <label className="block">
              <span className="label">Name</span>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Bar weight (lb)</span>
                <input
                  inputMode="decimal"
                  value={editing.bar_weight_lb}
                  onChange={(e) => setEditing({ ...editing, bar_weight_lb: Number(e.target.value) || 0 })}
                  className="num tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                />
              </label>
              <label className="block">
                <span className="label">Smith bar (lb)</span>
                <input
                  inputMode="decimal"
                  value={editing.smith_bar_weight_lb}
                  onChange={(e) => setEditing({ ...editing, smith_bar_weight_lb: Number(e.target.value) || 0 })}
                  className="num tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
                />
              </label>
            </div>

            <p className="rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
              Smith machines are counterbalanced: the bar itself is usually <strong>15–20 lb</strong> effective, not 45.
              Default is 20 lb — check the sticker on your club’s machine and adjust once.
            </p>

            <label className="block">
              <span className="label">Travel & setup overhead (min)</span>
              <input
                inputMode="decimal"
                value={editing.overhead_min ?? 0}
                onChange={(e) => setEditing({ ...editing, overhead_min: Number(e.target.value) || 0 })}
                className="num tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base"
                style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
              />
            </label>

            <div>
              <span className="label">Equipment</span>
              <div className="mt-2">
                <EquipmentChecklist
                  value={editing.equipment}
                  onChange={(equipment) => setEditing({ ...editing, equipment })}
                />
              </div>
            </div>

            <button type="button" className="btn btn-primary btn-lg" onClick={() => save(editing)}>
              Save location
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
