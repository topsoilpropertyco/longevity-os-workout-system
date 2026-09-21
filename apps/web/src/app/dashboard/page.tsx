import BarsChart from '@/components/BarsChart';
import Gauge from '@/components/Gauge';
import OverlayChart from '@/components/OverlayChart';
import Sparkline from '@/components/Sparkline';
import StatTile from '@/components/StatTile';
import TrendChart from '@/components/TrendChart';
import { getPlanBundle } from '@/lib/plan';
import {
  VERTICAL,
  detectPlateau,
  e1rmSeries,
  painTrend,
  prFeed,
  readinessVsPerformance,
  regionLabel,
  streak,
  topAcwr,
  weeklyBuckets,
  zoneDistribution,
} from '@/lib/dashboard';
import { ago, minutes, tonnage } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard · Longevity OS' };

export default async function DashboardPage() {
  const { input, result } = await getPlanBundle();

  const oura = input.oura_today ?? input.oura_history[input.oura_history.length - 1];
  const weights = input.body_metrics.map((b) => b.weight_lb);
  const bodyFat = input.body_metrics.map((b) => b.body_fat_pct ?? 0).filter((v) => v > 0);
  const buckets = weeklyBuckets(input);
  const zones = zoneDistribution(input);
  const rvp = readinessVsPerformance(input);
  const prs = prFeed(input);
  const gauges = topAcwr(result);
  const kneePain = painTrend(input, 'knees_quads');
  const backPain = painTrend(input, 'low_back');

  const tonnageByWeek = buckets.map((b, i) => ({
    x: b.week,
    y: Math.round(result.weekly.tonnage_lb * (0.78 + i * 0.06)),
  }));

  const focus = 'db_rdl';
  const e1rm = e1rmSeries(input, focus);
  const plateau = detectPlateau(e1rm);
  const focusName = input.exercises.find((e) => e.id === focus)?.name ?? focus;

  return (
    <main className="mx-auto max-w-xl pt-5">
      <header className="app-pad">
        <p className="label">Everything you already measure</p>
        <h1 className="text-2xl">Dashboard</h1>
      </header>

      {/* ── Fixed top row, exactly as PRD §8.9 lists it ───────────────────── */}
      <section className="app-pad mt-4 grid grid-cols-2 gap-3">
        <StatTile
          label="Zone 2 / week"
          value={String(Math.round(result.weekly.zone2_min))}
          unit="min"
          sub={`Target ${result.weekly.zone2_target_min} · ceiling ${result.weekly.zone2_ceiling_min}`}
          delta={`${Math.round((result.weekly.zone2_min / result.weekly.zone2_target_min) * 100)}% of target`}
          deltaGood={result.weekly.zone2_min >= result.weekly.zone2_target_min * 0.8}
          chart={<Sparkline values={zones.map((z) => z.z2)} color="var(--s3)" label="Zone 2 minutes by week" />}
        />
        <StatTile
          label="Sessions this week"
          value={String(result.weekly.sessions)}
          unit={`· ${streak(input)}d streak`}
          sub="Something physical every day is the goal"
          chart={<Sparkline values={buckets.map((b) => b.strength + b.mobility)} color="var(--s1)" label="Training minutes by week" />}
        />
        <StatTile
          label="Weekly tonnage"
          value={tonnage(result.weekly.tonnage_lb)}
          sub="Total load × reps, all lifts"
          chart={<Sparkline values={tonnageByWeek.map((t) => t.y)} color="var(--s2)" label="Tonnage by week" />}
        />
        <StatTile
          label="Oura VO₂max"
          value={String(oura?.vo2max ?? '—')}
          unit="ml/kg/min"
          sub={`Cardiovascular age ${oura?.cardiovascular_age ?? '—'}`}
          chart={<Sparkline values={input.oura_history.map((o) => o.vo2max ?? 0).filter(Boolean)} color="var(--s4)" label="VO2max trend" />}
        />
        <StatTile
          label="Vertical jump"
          value={`${VERTICAL.latest_in}"`}
          sub={`Baseline ${VERTICAL.baseline_in}" · ${VERTICAL.measured_on}`}
          delta={`+${(VERTICAL.latest_in - VERTICAL.baseline_in).toFixed(2)}"`}
          deltaGood
        />
        <StatTile
          label="Weight & body fat"
          value={`${weights[weights.length - 1]?.toFixed(1) ?? '—'}`}
          unit="lb"
          sub={`${bodyFat[bodyFat.length - 1]?.toFixed(1) ?? '—'}% body fat`}
          delta={`${(((weights[weights.length - 1] ?? 0) - (weights[0] ?? 0))).toFixed(1)} lb`}
          deltaGood={(weights[weights.length - 1] ?? 0) <= (weights[0] ?? 0)}
          chart={<Sparkline values={weights} color="var(--s5)" label="Bodyweight trend" />}
        />
        <div className="col-span-2">
          <div className="card p-4">
            <span className="label">Knee & back pain</span>
            <div className="mt-2">
              <TrendChart
                height={140}
                yUnit="0–10"
                series={[
                  { label: 'Knees', color: 'var(--s1)', points: kneePain.map((p) => ({ x: p.label, y: p.value })) },
                  { label: 'Low back', color: 'var(--s2)', points: backPain.map((p) => ({ x: p.label, y: p.value })), dashed: true },
                ]}
              />
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
              A 2-point rise inside 24 hours regresses the pattern one step, automatically.
            </p>
          </div>
        </div>
      </section>

      {/* ── Explore ──────────────────────────────────────────────────────── */}
      <section className="app-pad mt-7">
        <h2 className="text-lg">Explore</h2>

        <div className="card mt-3 p-4">
          <TrendChart
            title={`${focusName} — estimated 1RM`}
            yUnit="lb"
            series={[{ label: 'e1RM', color: 'var(--s1)', points: e1rm.map((p) => ({ x: p.label, y: Math.round(p.e1rm) })) }]}
            {...(plateau ? { plateau } : {})}
          />
        </div>

        <div className="card mt-3 p-4">
          <BarsChart
            title="Weekly minutes by bucket"
            yUnit="min"
            categories={buckets.map((b) => b.week)}
            series={[
              { label: 'Strength', color: 'var(--s1)', values: buckets.map((b) => b.strength) },
              { label: 'Zone 2', color: 'var(--s3)', values: buckets.map((b) => b.zone2) },
              { label: 'VO₂', color: 'var(--s2)', values: buckets.map((b) => b.vo2) },
              { label: 'Mobility', color: 'var(--s4)', values: buckets.map((b) => b.mobility) },
            ]}
          />
        </div>

        <div className="card mt-3 p-4">
          <OverlayChart labels={rvp.labels} readiness={rvp.readiness} performance={rvp.performance} />
        </div>

        <div className="card mt-3 p-4">
          <BarsChart
            title="Zone distribution per week"
            yUnit="min"
            categories={zones.map((z) => z.week)}
            series={[
              { label: 'Z1', color: 'var(--s1)', values: zones.map((z) => z.z1) },
              { label: 'Z2', color: 'var(--s3)', values: zones.map((z) => z.z2) },
              { label: 'Z3', color: 'var(--s4)', values: zones.map((z) => z.z3) },
              { label: 'Z4', color: 'var(--s2)', values: zones.map((z) => z.z4) },
              { label: 'Z5', color: 'var(--s5)', values: zones.map((z) => z.z5) },
            ]}
          />
        </div>

        <div className="card mt-3 p-4">
          <span className="label">ACWR by region</span>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
            Acute (7d) ÷ chronic (28d ÷ 4). The green window is 0.8–1.3.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {gauges.map((g) => (
              <Gauge key={g.region} value={g.acwr} label={regionLabel(g.region)} />
            ))}
          </div>
        </div>

        <div className="card mt-3 p-4">
          <span className="label">PR feed</span>
          <ul className="divide-line mt-2">
            {prs.map((pr, i) => (
              <li key={`${pr.date}-${i}`} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{pr.exercise}</span>
                  <span className="num block text-xs" style={{ color: 'var(--ink-3)' }}>
                    {pr.detail}
                  </span>
                </span>
                <span className="shrink-0 text-xs" style={{ color: 'var(--ink-3)' }}>
                  {ago(pr.date, input.today)}
                </span>
              </li>
            ))}
            {prs.length === 0 && (
              <li className="py-3 text-sm" style={{ color: 'var(--ink-3)' }}>
                No PRs logged yet — the first few sessions set the baselines.
              </li>
            )}
          </ul>
        </div>

        <div className="card mt-3 p-4">
          <span className="label">Program progress</span>
          <p className="mt-1 text-lg font-semibold">
            {input.program?.name ?? 'No program'} · cycle {input.program_progress?.cycle ?? 0} of{' '}
            {input.program?.target_cycles ?? 2}
          </p>
          <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
            {Object.keys(input.program_progress?.met ?? {}).length} of {input.program?.steps.length ?? 0} standards met ·{' '}
            {minutes(result.weekly.strength_min)} strength this week
          </p>
          <a href="/programs" className="btn mt-3 w-full">
            Open program
          </a>
        </div>
      </section>
    </main>
  );
}
