'use client';

import { useMemo, useState } from 'react';
import { EQUIPMENT, type Equipment, type LocationEquipmentSpec } from '@/lib/engine-bridge';
import { EQUIPMENT_CATEGORIES, equipmentLabel } from '@/lib/equipment-catalog';

/**
 * The equipment catalog as a checklist. Grouped, searchable, every row a ≥44 px
 * target — this is how a location is defined (PRD §8.3).
 */
export default function EquipmentChecklist({
  value,
  onChange,
  readOnly = false,
}: {
  value: LocationEquipmentSpec[];
  onChange?: (next: LocationEquipmentSpec[]) => void;
  readOnly?: boolean;
}) {
  const [query, setQuery] = useState('');
  const selected = useMemo(
    () => new Set(value.filter((v) => v.available).map((v) => v.equipment)),
    [value],
  );

  const toggle = (item: Equipment) => {
    if (readOnly || !onChange) return;
    const exists = value.find((v) => v.equipment === item);
    if (exists) onChange(value.map((v) => (v.equipment === item ? { ...v, available: !v.available } : v)));
    else onChange([...value, { equipment: item, available: true }]);
  };

  const q = query.trim().toLowerCase();

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search equipment"
        className="tap w-full rounded-xl border bg-transparent px-3 text-base"
        style={{ borderColor: 'var(--line)', color: 'var(--ink)' }}
        aria-label="Search equipment"
      />

      <p className="num mt-2 text-xs" style={{ color: 'var(--ink-3)' }}>
        {selected.size} of {EQUIPMENT.length} selected
      </p>

      <div className="mt-3 space-y-5">
        {EQUIPMENT_CATEGORIES.map((cat) => {
          const items = cat.items.filter((i) => !q || equipmentLabel(i).toLowerCase().includes(q));
          if (items.length === 0) return null;
          return (
            <section key={cat.name}>
              <h3 className="label">{cat.name}</h3>
              <ul className="mt-1.5 grid grid-cols-2 gap-1.5">
                {items.map((item) => {
                  const on = selected.has(item);
                  return (
                    <li key={item}>
                      <button
                        type="button"
                        onClick={() => toggle(item)}
                        aria-pressed={on}
                        disabled={readOnly}
                        className="tap flex w-full items-center gap-2 rounded-xl border px-2.5 text-left text-[0.8125rem] font-medium"
                        style={{
                          background: on ? 'var(--accent-soft)' : 'var(--surface-2)',
                          borderColor: on ? 'var(--accent)' : 'var(--line)',
                          color: on ? 'var(--ink)' : 'var(--ink-2)',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border text-[0.5rem]"
                          style={{
                            borderColor: on ? 'transparent' : 'var(--ink-3)',
                            background: on ? 'var(--accent)' : 'transparent',
                            color: 'var(--accent-ink)',
                          }}
                        >
                          {on ? '✓' : ''}
                        </span>
                        <span className="truncate">{equipmentLabel(item)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
