'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import Sheet from './Sheet';
import { useToast } from './Toast';
import type { WeekDay } from '@/lib/engine-bridge';
import { commitPullForward, previewPullForward } from '@/lib/actions';
import { minutes, relativeDay, dayNumber } from '@/lib/format';

const BAND_TONE: Record<string, string> = {
  push: 'var(--good)',
  as_planned: 'var(--s1)',
  reduced: 'var(--warn)',
  recovery: 'var(--bad)',
};

/**
 * Today plus the next six days, snapping horizontally inside its own container.
 * Tapping a future day offers "Do this today" — and shows the one-line diff of
 * what that does to the rest of the week before anything is committed.
 */
export default function WeekCarousel({ week, todayIso }: { week: WeekDay[]; todayIso: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<WeekDay | null>(null);
  const [diff, setDiff] = useState<string | null>(null);

  const openDay = (day: WeekDay) => {
    if (day.is_today) return;
    setTarget(day);
    setDiff(null);
    start(async () => {
      const res = await previewPullForward(day.date);
      setDiff(res.diff);
    });
  };

  return (
    <>
      <div className="scroller -mx-[1.125rem] gap-3 px-[1.125rem] pb-2">
        {week.map((day) => {
          const tone = BAND_TONE[day.session.readiness.band] ?? 'var(--s1)';
          return (
            <button
              key={day.date}
              type="button"
              onClick={() => openDay(day)}
              className="snap card w-[16.5rem] p-4 text-left"
              style={{ borderColor: day.is_today ? 'var(--accent)' : 'var(--line)' }}
            >
              <div className="flex items-baseline justify-between">
                <span className="label" style={{ color: day.is_today ? 'var(--accent)' : 'var(--ink-3)' }}>
                  {relativeDay(day.date, todayIso)}
                </span>
                <span className="num text-xs" style={{ color: 'var(--ink-3)' }}>
                  {dayNumber(day.date)}
                </span>
              </div>

              <h3 className="mt-1.5 text-lg leading-tight">{day.session.title}</h3>
              <p className="num mt-1 text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                {minutes(day.session.estimated_min)} · {day.session.type}
              </p>
              <p className="mt-2 text-xs leading-snug" style={{ color: 'var(--ink-3)', minHeight: '2.4rem' }}>
                {day.session.why}
              </p>

              <div className="mt-2 flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: tone }} />
                <span className="text-[0.625rem] font-semibold uppercase tracking-wide" style={{ color: tone }}>
                  {day.is_today ? day.session.readiness.band.replace('_', ' ') : 'projected'}
                </span>
              </div>

              {day.is_today ? (
                <span className="btn btn-primary mt-3 w-full">Today</span>
              ) : (
                <span className="btn mt-3 w-full">Do this today</span>
              )}
            </button>
          );
        })}
      </div>

      <Sheet
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `Do ${target.session.title} today?` : ''}
        subtitle="The engine re-solves the rest of the week under the same constraints."
      >
        <div className="pb-6">
          <div className="card p-4">
            <span className="label">What changes</span>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--ink)' }}>
              {diff ?? 'Working it out…'}
            </p>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-lg mt-4"
            disabled={pending || !diff}
            onClick={() => {
              const date = target?.date;
              if (!date) return;
              start(async () => {
                const res = await commitPullForward(date);
                toast(res.message ?? 'Week rebalanced.', 'good');
                setTarget(null);
              });
            }}
          >
            {pending ? 'Re-solving…' : 'Yes, move it to today'}
          </button>
          <button type="button" className="btn mt-2 w-full" onClick={() => setTarget(null)}>
            Leave the week alone
          </button>

          {target && (
            <Link href="/" className="mt-4 block text-center text-xs underline" style={{ color: 'var(--ink-3)' }}>
              Back to today
            </Link>
          )}
        </div>
      </Sheet>
    </>
  );
}
