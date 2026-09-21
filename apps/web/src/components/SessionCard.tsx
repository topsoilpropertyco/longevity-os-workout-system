import Link from 'next/link';
import ReadinessRing from './ReadinessRing';
import WhyLine from './WhyLine';
import type { PrescribedSession } from '@/lib/engine-bridge';
import { minutes } from '@/lib/format';

const TYPE_LABEL: Record<PrescribedSession['type'], string> = {
  strength: 'Strength',
  kot: 'Knees Over Toes',
  power: 'Power',
  vo2: 'VO₂',
  zone2: 'Zone 2',
  sprint: 'Sprints',
  mobility: 'Mobility',
  recovery: 'Recovery',
  external: 'External',
};

/** The one card that answers "what am I doing today?" before anything else loads. */
export default function SessionCard({
  session,
  locationName,
  href,
  showStart = true,
}: {
  session: PrescribedSession;
  locationName: string;
  href?: string;
  showStart?: boolean;
}) {
  const blocks = session.blocks.filter((b) => b.kind !== 'warmup' && b.kind !== 'cooldown');

  return (
    <section className="card overflow-hidden">
      <div className="flex items-start gap-4 p-5 pb-4">
        <ReadinessRing readiness={session.readiness} />
        <div className="min-w-0 flex-1">
          {TYPE_LABEL[session.type].toLowerCase() !== session.title.toLowerCase() && (
            <span className="label">{TYPE_LABEL[session.type]}</span>
          )}
          <h1 className="mt-0.5 text-[1.75rem] leading-[1.1]">{session.title}</h1>
          <p className="num mt-1.5 text-sm font-semibold" style={{ color: 'var(--ink-2)' }}>
            {minutes(session.estimated_min)} · {locationName}
          </p>
        </div>
      </div>

      <div className="px-5">
        <WhyLine reasons={session.readiness.reasons.slice(0, 2)}>{session.why}</WhyLine>
      </div>

      <ul className="mt-4 px-5">
        {blocks.map((b) => (
          <li
            key={b.kind + b.title}
            className="flex items-baseline justify-between gap-3 border-t py-2.5 text-sm"
            style={{ borderColor: 'var(--line)' }}
          >
            <span className="min-w-0">
              <span className="font-semibold">{b.title}</span>
              <span className="ml-2 truncate text-xs" style={{ color: 'var(--ink-3)' }}>
                {b.cardio
                  ? `${b.cardio.modality} · ${b.cardio.structure.replace('_', ' ')}`
                  : b.exercises.map((e) => e.exercise.name).join(' · ')}
              </span>
            </span>
            <span className="num shrink-0 text-xs" style={{ color: 'var(--ink-3)' }}>
              {Math.round(b.estimated_min)}m
            </span>
          </li>
        ))}
      </ul>

      {session.notes.length > 0 && (
        <p className="mt-3 px-5 text-xs leading-snug" style={{ color: 'var(--ink-3)' }}>
          {session.notes[0]}
        </p>
      )}

      {showStart && href && (
        <div className="p-5 pt-4">
          <Link href={href} className="btn btn-primary btn-lg">
            Start · {minutes(session.estimated_min)}
          </Link>
        </div>
      )}
    </section>
  );
}
