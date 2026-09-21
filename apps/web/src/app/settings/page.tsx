import Link from 'next/link';
import DataExport from '@/components/DataExport';
import GoalModePicker from '@/components/GoalModePicker';
import { signOut } from '@/lib/actions';
import { getViewer } from '@/lib/auth';
import { getPlanBundle } from '@/lib/plan';
import { ouraStatus } from '@/lib/integrations-bridge';
import { lb, minutes } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · Longevity OS' };

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t py-3" style={{ borderColor: 'var(--line)' }}>
      <span className="text-sm">
        {label}
        {hint && (
          <span className="block text-xs" style={{ color: 'var(--ink-3)' }}>
            {hint}
          </span>
        )}
      </span>
      <span className="num shrink-0 text-sm font-semibold">{value}</span>
    </div>
  );
}

function CredentialRow({
  name,
  present,
  note,
  href,
  cta,
}: {
  name: string;
  present: boolean;
  note: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t py-3" style={{ borderColor: 'var(--line)' }}>
      <span className="text-sm">
        {name}
        <span className="block text-xs" style={{ color: 'var(--ink-3)' }}>
          {note}
        </span>
      </span>
      <span
        className="chip"
        style={{ color: present ? 'var(--good)' : 'var(--ink-3)', borderColor: present ? 'var(--good)' : 'var(--line)' }}
      >
        {present ? '● Connected' : '○ Not connected'}
      </span>
      {href && cta && (
        <a href={href} className="btn tap ml-2 px-3 text-xs">
          {cta}
        </a>
      )}
      <span className="hidden">
      </span>
    </div>
  );
}

export default async function SettingsPage() {
  const { input, result } = await getPlanBundle();
  const viewer = await getViewer();
  const hrMax = input.athlete.hr_max ?? 220 - 34;
  const zones: [string, number, number][] = [
    ['Z1 recovery', 0.5, 0.6],
    ['Z2 aerobic', 0.6, 0.7],
    ['Z3 tempo', 0.7, 0.8],
    ['Z4 threshold', 0.8, 0.9],
    ['Z5 VO₂', 0.9, 1.0],
  ];

  const ouraState = ouraStatus();

  // Presence only — a secret is never rendered, not even masked.
  const credentials = [
    // Oura is OAuth now — personal access tokens were retired in December 2025.
    // Reading OURA_PAT here reported "not connected" to someone who had just
    // connected successfully, which is the worst kind of wrong: it invites them
    // to go and fix something that is not broken.
    {
      name: 'Oura',
      present: ouraState !== 'unconfigured',
      note:
        ouraState === 'oauth'
          ? 'OAuth app · nightly sync'
          : ouraState === 'legacy_pat'
            ? 'Legacy personal access token · cannot be reissued'
            : 'Not set up — run scripts/oura-auth.ts, or connect below',
      href: ouraState === 'unconfigured' ? '/api/oura/connect' : undefined,
      cta: ouraState === 'unconfigured' ? 'Connect' : undefined,
    },
    { name: 'Strava', present: Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET), note: 'OAuth app · webhook + nightly reconcile' },
    { name: 'Telegram', present: Boolean(process.env.TELEGRAM_BOT_TOKEN), note: 'Bot token · webhook secret verified' },
    { name: 'LM Studio', present: Boolean(process.env.LMSTUDIO_BASE_URL), note: 'Mac mini worker · outbound only' },
    { name: 'Gemini (fallback)', present: Boolean(process.env.GEMINI_API_KEY), note: 'Free tier · used when the mini is asleep' },
    { name: 'Supabase', present: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL), note: 'Postgres + RLS + storage' },
  ];

  return (
    <main className="app-pad mx-auto max-w-xl space-y-6 pt-5">
      <header>
        <p className="label">Set it once</p>
        <h1 className="text-2xl">Settings</h1>
      </header>

      {/*
        First card on the screen because it answers the question everything else
        depends on: is this my data, or the demo? Getting that wrong silently is
        the failure this section exists to make impossible.
      */}
      <section className="card p-4">
        <h2 className="text-base">Account</h2>
        {viewer.kind === 'member' ? (
          <>
            <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
              Signed in as <span className="font-semibold">{viewer.email ?? 'this device'}</span>. Everything below is
              read from your own rows.
            </p>
            <form action={signOut}>
              <button type="submit" className="btn tap mt-3 w-full">
                Sign out
              </button>
            </form>
            <p className="mt-2 text-xs" style={{ color: 'var(--ink-3)' }}>
              You will need a new emailed link to get back in. There is no reason to do this on your own phone.
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
            <span className="font-semibold">Demo data.</span> This build has no Supabase keys, so every screen is
            showing the fixture athlete — nothing you do here is saved anywhere but this browser.
          </p>
        )}
      </section>

      <section className="card p-4">
        <h2 className="text-base">Goal mode</h2>
        <p className="mb-3 text-xs" style={{ color: 'var(--ink-3)' }}>
          Changing this re-solves the week and shifts the rep and load bands.
        </p>
        <GoalModePicker current={input.goals.mode} />
      </section>

      <section className="card p-4">
        <h2 className="text-base">Warm-up & cooldown</h2>
        <Row label="Warm-up" value={minutes(input.goals.warmup_min)} />
        <Row label="Cooldown" value={minutes(input.goals.cooldown_min)} />
        <Row
          label="On top of the budget"
          value={input.goals.warmup_outside_budget ? 'Yes' : 'No'}
          hint="When yes, 45 minutes means 45 minutes of work."
        />
      </section>

      <section className="card p-4">
        <h2 className="text-base">Units</h2>
        <p className="text-xs" style={{ color: 'var(--ink-3)' }}>
          Display only — everything is stored as <code>load_lb</code> and miles.
        </p>
        <Row label="Weight" value="Pounds (lb)" />
        <Row label="Distance" value="Miles (mi)" />
      </section>

      <section className="card p-4">
        <h2 className="text-base">Total-load convention</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
          Every weight in this app is the <strong>total</strong> you are moving. A pair of 40 lb dumbbells is{' '}
          <span className="num">80 lb</span>. A Smith bar with two 25s is{' '}
          <span className="num">{lb(input.location.smith_bar_weight_lb + 50)}</span> — the counterbalanced bar counts as{' '}
          {lb(input.location.smith_bar_weight_lb)} at this location, not 45. Bodyweight moves record only what you{' '}
          <em>added</em>; your bodyweight comes from the latest scale entry ({lb(input.athlete.bodyweight_lb)}).
        </p>
      </section>

      <section className="card p-4">
        <h2 className="text-base">HRmax & zones</h2>
        <Row
          label="HRmax"
          value={`${hrMax} bpm`}
          hint={
            input.athlete.hr_max_source === 'measured_strava'
              ? 'Source: measured — highest Strava HR in 90 days'
              : input.athlete.hr_max_source === 'oura'
                ? 'Source: Oura'
                : 'Source: 220 − age (least accurate)'
          }
        />
        {zones.map(([name, lo, hi]) => (
          <Row key={name} label={name} value={`${Math.round(hrMax * lo)}–${Math.round(hrMax * hi)} bpm`} />
        ))}
      </section>

      <section className="card p-4">
        <h2 className="text-base">Bar weights per location</h2>
        {(input.all_locations ?? []).map((loc) => (
          <Row
            key={loc.id}
            label={loc.name}
            value={`Bar ${lb(loc.bar_weight_lb)} · Smith ${lb(loc.smith_bar_weight_lb)}`}
            hint={loc.kind === 'planet_fitness' ? 'Smith machines are counterbalanced — 15–20 lb effective' : undefined}
          />
        ))}
        <Link href="/locations" className="btn mt-3 w-full">
          Edit locations
        </Link>
      </section>

      <section className="card p-4">
        <h2 className="text-base">Bot schedule</h2>
        <Row label="Daily brief" value="06:30" hint="Readiness, today's session, quick buttons" />
        <Row label="Post-session summary" value="On finish" />
        <Row label="Weekly report" value="Sunday 18:00" />
        <Row label="Scale prompt" value="Saturday 07:00" />
        <Row label="Injury check-in" value="Sunday 19:00" />
      </section>

      <section className="card p-4">
        <h2 className="text-base">Integrations</h2>
        <p className="mb-1 text-xs" style={{ color: 'var(--ink-3)' }}>
          Status only. Secrets live in the environment and are never displayed.
        </p>
        {credentials.map((c) => (
          <CredentialRow key={c.name} {...c} />
        ))}
      </section>

      <section className="card p-4">
        <h2 className="text-base">Data export</h2>
        <p className="mb-3 text-xs" style={{ color: 'var(--ink-3)' }}>
          Your data, on your device. Nothing is uploaded.
        </p>
        <DataExport
          payload={{
            exported_at: new Date().toISOString(),
            athlete: input.athlete,
            goals: input.goals,
            locations: input.all_locations,
            injuries: input.injuries,
            body_metrics: input.body_metrics,
            history: input.history,
            cardio_history: input.cardio_history,
            weekly: result.weekly,
          }}
        />
      </section>

      <section className="card p-4">
        <h2 className="text-base">Other</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Link href="/injuries" className="btn tap">
            Injury register
          </Link>
          <Link href="/programs" className="btn tap">
            Program
          </Link>
          <Link href="/locations" className="btn tap">
            Locations
          </Link>
          <Link href="/onboarding" className="btn tap">
            Re-run setup
          </Link>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="text-base">Credits</h2>
        <ul className="mt-2 space-y-2 text-sm" style={{ color: 'var(--ink-2)' }}>
          <li>
            Exercise media —{' '}
            <a href="https://gymvisual.com/" className="underline">
              © Gym visual — https://gymvisual.com/
            </a>
          </li>
          <li>
            Exercise metadata —{' '}
            <a href="https://github.com/yuhonas/free-exercise-db" className="underline">
              yuhonas/free-exercise-db
            </a>{' '}
            (public domain)
          </li>
          <li>Knees Over Toes program — Ben Patrick. Normalized from Seth’s own spreadsheets.</li>
          <li>Readiness inputs — Oura API v2. Cardio — Strava API.</li>
        </ul>
        <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>
          Plan signature <span className="num">{result.signature}</span>
        </p>
      </section>
    </main>
  );
}
