import { Suspense } from 'react';
import Link from 'next/link';
import ProvenanceBanner from '@/components/ProvenanceBanner';
import SessionCard from '@/components/SessionCard';
import TodayControls from '@/components/TodayControls';
import { TodayCardSkeleton } from '@/components/Skeleton';
import { getPlanBundle } from '@/lib/plan';
import { longDate, minutes } from '@/lib/format';

/** Re-plan on every open (CLAUDE.md invariant 4) — never a cached prescription. */
export const dynamic = 'force-dynamic';

async function Today() {
  const { input, result, today, provenance } = await getPlanBundle();
  const session = result.today;
  const ouraPresent = Boolean(input.oura_today?.readiness_score);
  const tomorrow = result.week[1]?.session;

  return (
    <>
      <ProvenanceBanner provenance={provenance} />

      <SessionCard session={session} locationName={input.location.name} showStart={false} />

      {/* Primary action lives in the thumb zone, not in the flow of the page. */}
      <div className="thumb-bar">
        <div className="mx-auto max-w-xl">
          <Link href={`/session/${session.date}`} className="btn btn-primary btn-lg">
            Start · {minutes(session.estimated_min)}
          </Link>
        </div>
      </div>

      <TodayControls
        budget={input.budget_min}
        location={input.location}
        locations={input.all_locations ?? [input.location]}
        {...(input.self_report ? { selfReport: input.self_report } : {})}
        ouraPresent={ouraPresent}
      />

      <section className="card p-4">
        <div className="flex items-baseline justify-between">
          <span className="label">This week</span>
          <Link href="/week" className="text-xs font-semibold underline" style={{ color: 'var(--ink-2)' }}>
            See the week
          </Link>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { k: 'Zone 2', v: `${Math.round(result.weekly.zone2_min)}′`, sub: `of ${result.weekly.zone2_target_min}` },
            { k: 'Sessions', v: String(result.weekly.sessions), sub: 'last 7 days' },
            { k: 'Strength', v: `${Math.round(result.weekly.strength_min)}′`, sub: `${result.weekly.strength_target_min[0]}–${result.weekly.strength_target_min[1]}` },
          ].map((c) => (
            <div key={c.k} className="rounded-xl px-2 py-2" style={{ background: 'var(--surface-2)' }}>
              <dt className="label">{c.k}</dt>
              <dd className="num mt-0.5 text-lg font-semibold leading-none">{c.v}</dd>
              <dd className="text-[0.625rem]" style={{ color: 'var(--ink-3)' }}>
                {c.sub}
              </dd>
            </div>
          ))}
        </dl>
        {tomorrow && (
          <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>
            Tomorrow · {tomorrow.title} · {minutes(tomorrow.estimated_min)}
          </p>
        )}
      </section>
    </>
  );
}

export default async function TodayPage() {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (
    <main className="app-pad mx-auto flex max-w-xl flex-col gap-5 pb-6 pt-5">
      <header className="flex items-baseline justify-between">
        <div>
          <p className="label">{longDate(iso)}</p>
          <h1 className="text-2xl">Today</h1>
        </div>
        <Link href="/settings" className="chip tap" aria-label="Settings">
          Setup
        </Link>
      </header>

      <Suspense fallback={<TodayCardSkeleton />}>
        <Today />
      </Suspense>
    </main>
  );
}
