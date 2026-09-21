import type { PredictionBand as PredictionBandData } from '@/lib/engine-bridge';
import { lb } from '@/lib/format';

/**
 * Normal / probable / max, on one line of scale. The three words are always
 * present — the bar is the illustration, not the message.
 */
export default function PredictionBand({ band, reps }: { band: PredictionBandData; reps?: number }) {
  const lo = Math.min(band.normal[0], band.probable) * 0.94;
  const hi = Math.max(band.max, band.normal[1]) * 1.03;
  const span = Math.max(1, hi - lo);
  const x = (v: number) => ((v - lo) / span) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">Prediction{reps ? ` · ${reps} reps` : ''}</span>
        <span className="text-[0.625rem]" style={{ color: 'var(--ink-3)' }}>
          {band.basis === 'history'
            ? `${Math.round(band.confidence * 100)}% confidence`
            : band.basis === 'program_standard'
              ? 'from the program standard'
              : 'cold start — log a set to sharpen this'}
        </span>
      </div>

      <div className="relative mt-2 h-8">
        <div className="absolute left-0 right-0 top-3 h-1.5 rounded-full" style={{ background: 'var(--surface-2)' }} />
        <div
          className="absolute top-3 h-1.5 rounded-full"
          style={{
            left: `${x(band.normal[0])}%`,
            width: `${Math.max(2, x(band.normal[1]) - x(band.normal[0]))}%`,
            background: 'color-mix(in srgb, var(--s1) 45%, transparent)',
          }}
        />
        <div
          className="absolute top-1 h-5 w-[3px] rounded-full"
          style={{ left: `${x(band.probable)}%`, background: 'var(--accent)' }}
        />
        <div
          className="absolute top-1.5 h-4 w-[2px] rounded-full"
          style={{ left: `${x(band.max)}%`, background: 'var(--ink-3)' }}
        />
      </div>

      <dl className="mt-1 grid grid-cols-3 gap-2 text-center">
        <div>
          <dt className="text-[0.625rem] uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
            Normal
          </dt>
          <dd className="num text-sm font-semibold">
            {lb(band.normal[0], { compact: true })}–{lb(band.normal[1], { compact: true })}
          </dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
            Probable
          </dt>
          <dd className="num text-sm font-bold">{lb(band.probable)}</dd>
        </div>
        <div>
          <dt className="text-[0.625rem] uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
            Max
          </dt>
          <dd className="num text-sm font-semibold">{lb(band.max, { compact: true })}</dd>
        </div>
      </dl>
    </div>
  );
}
