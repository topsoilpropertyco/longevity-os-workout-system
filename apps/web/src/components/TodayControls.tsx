'use client';

import { useState, useTransition } from 'react';
import LocationChip from './LocationChip';
import MinutesPicker from './MinutesPicker';
import SliderRow from './SliderRow';
import { useToast } from './Toast';
import { setBudget, setLocation, setSelfReport } from '@/lib/actions';
import type { GymLocation, SelfReport, Slider1to5 } from '@/lib/engine-bridge';

/**
 * Everything Seth can change about today in one or two taps.
 *
 * The sliders are prominent when Oura has not reported; when it has, they
 * collapse to a single "Add how you feel" affordance so the screen keeps one
 * idea.
 */
export default function TodayControls({
  budget,
  location,
  locations,
  selfReport,
  ouraPresent,
}: {
  budget: number;
  location: GymLocation;
  locations: GymLocation[];
  selfReport?: SelfReport;
  ouraPresent: boolean;
}) {
  const toast = useToast();
  const [, start] = useTransition();
  const [expanded, setExpanded] = useState(!ouraPresent);
  const [soreness, setSoreness] = useState<Slider1to5 | undefined>(selfReport?.soreness);
  const [energy, setEnergy] = useState<Slider1to5 | undefined>(selfReport?.energy);
  const [stress, setStress] = useState<Slider1to5 | undefined>(selfReport?.stress);

  const submit = (s?: Slider1to5, e?: Slider1to5, st?: Slider1to5) => {
    if (!s || !e || !st) return;
    start(async () => {
      await setSelfReport(s, e, st);
      toast('Re-planned with how you feel.', 'good');
    });
  };

  return (
    <section className="space-y-4">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label">Minutes</span>
          <span className="num text-xs" style={{ color: 'var(--ink-3)' }}>
            warm-up sits on top
          </span>
        </div>
        <MinutesPicker
          value={budget}
          onSelect={async (m) => {
            await setBudget(m);
            toast(`Re-planned for ${m} minutes.`, 'good');
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <LocationChip
          current={location}
          locations={locations}
          onSelect={async (id) => {
            await setLocation(id);
            toast('Location switched. Equipment filtered.', 'good');
          }}
        />
        {!expanded && (
          <button type="button" className="chip tap" onClick={() => setExpanded(true)}>
            {selfReport ? `Feel · ${selfReport.soreness}/${selfReport.energy}/${selfReport.stress}` : 'Add how you feel'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="card animate-rise-in space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base">How do you feel?</h2>
              <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
                {ouraPresent
                  ? 'Oura already reported — this refines it.'
                  : 'No Oura data this morning, so this is what the plan uses.'}
              </p>
            </div>
            {ouraPresent && (
              <button type="button" className="chip tap" onClick={() => setExpanded(false)}>
                Hide
              </button>
            )}
          </div>

          <SliderRow
            label="Soreness"
            value={soreness}
            lowLabel="Wrecked"
            highLabel="Not sore"
            onChange={(v) => {
              setSoreness(v);
              submit(v, energy, stress);
            }}
          />
          <SliderRow
            label="Energy"
            value={energy}
            lowLabel="Flat"
            highLabel="Energized"
            onChange={(v) => {
              setEnergy(v);
              submit(soreness, v, stress);
            }}
          />
          <SliderRow
            label="Stress"
            value={stress}
            lowLabel="Calm"
            highLabel="Maxed out"
            onChange={(v) => {
              setStress(v);
              submit(soreness, energy, v);
            }}
          />
        </div>
      )}
    </section>
  );
}
