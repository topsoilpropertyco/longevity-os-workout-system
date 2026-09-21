'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import Sheet from './Sheet';
import type { GymLocation } from '@/lib/engine-bridge';

const KIND_LABEL: Record<GymLocation['kind'], string> = {
  home: 'Home',
  planet_fitness: 'Planet Fitness',
  crossfit_box: 'CrossFit box',
  bodyweight_only: 'Travel',
  other: 'Gym',
};

export default function LocationChip({
  current,
  locations,
  onSelect,
}: {
  current: GymLocation;
  locations: GymLocation[];
  onSelect: (id: string) => void | Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="chip tap"
        style={{ opacity: pending ? 0.6 : 1 }}
        aria-haspopup="dialog"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" strokeLinejoin="round" />
          <circle cx="12" cy="10" r="2.4" />
        </svg>
        <span className="max-w-[10rem] truncate">{current.name}</span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Where are you training?" subtitle="Sticky — it stays until you change it.">
        <ul className="divide-line -mx-1">
          {locations.map((loc) => {
            const active = loc.id === current.id;
            const count = loc.equipment.filter((e) => e.available).length;
            return (
              <li key={loc.id}>
                <button
                  type="button"
                  onClick={() => {
                    start(() => void onSelect(loc.id));
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-1 py-4 text-left"
                >
                  <span>
                    <span className="block font-semibold">{loc.name}</span>
                    <span className="block text-xs" style={{ color: 'var(--ink-3)' }}>
                      {KIND_LABEL[loc.kind]} · {count} items
                      {loc.kind === 'planet_fitness' ? ` · Smith bar ${loc.smith_bar_weight_lb} lb` : ''}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-6 items-center justify-center rounded-full border text-xs"
                    style={{
                      borderColor: active ? 'transparent' : 'var(--line)',
                      background: active ? 'var(--accent)' : 'transparent',
                      color: 'var(--accent-ink)',
                    }}
                  >
                    {active ? '✓' : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <Link href="/locations" className="btn mt-3 w-full" onClick={() => setOpen(false)}>
          Manage locations
        </Link>
      </Sheet>
    </>
  );
}
