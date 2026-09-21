import WeekCarousel from '@/components/WeekCarousel';
import { getPlanBundle } from '@/lib/plan';
import { minutes } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Week · Longevity OS' };

export default async function WeekPage() {
  const { result, today, input } = await getPlanBundle();
  const totalMin = result.week.reduce((s, d) => s + d.session.estimated_min, 0);

  return (
    <main className="mx-auto max-w-xl pt-5">
      <header className="app-pad">
        <p className="label">Next seven days</p>
        <h1 className="text-2xl">The week</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
          {minutes(totalMin)} planned · {result.weekly.zone2_min}′ Zone 2 so far · {input.location.name}
        </p>
      </header>

      {/*
        The carousel bleeds to the screen edge with `-mx-[1.125rem]`, which only
        cancels out against a parent that carries the same padding. Without
        `app-pad` here it pushed 18px past the viewport and gave the page a
        horizontal scroll — the one thing CLAUDE.md is unambiguous about.
      */}
      <div className="app-pad mt-4">
        <WeekCarousel week={result.week} todayIso={today} />
      </div>

      <section className="app-pad mt-5">
        <h2 className="label">Why it is ordered this way</h2>
        <ul className="mt-2 space-y-2">
          {[
            'Power and program work land on the freshest days.',
            'Each region gets 48 hours — 72 after anything eccentric.',
            'Zone 2 fills the gaps and ramps no faster than 10% a week.',
            'Something physical every day: recovery is a session, not a gap.',
          ].map((line) => (
            <li key={line} className="flex gap-2.5 text-sm" style={{ color: 'var(--ink-2)' }}>
              <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: 'var(--ink-3)' }} />
              {line}
            </li>
          ))}
        </ul>
      </section>

      {result.warnings.length > 0 && (
        <section className="app-pad mt-5">
          <h2 className="label">Constraints the engine could not satisfy</h2>
          <ul className="mt-2 space-y-1.5">
            {result.warnings.map((w) => (
              <li key={w} className="text-sm" style={{ color: 'var(--warn)' }}>
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
