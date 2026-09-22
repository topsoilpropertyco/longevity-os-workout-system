import Link from 'next/link';
import type { PlanProvenance } from '@/lib/plan';

/**
 * The one thing the today card must never do quietly.
 *
 * Every screen falls back to fixtures when the database has nothing — that is
 * CLAUDE.md invariant 2, and on a cold clone with no Supabase at all it is
 * exactly right. But once somebody has signed in, the same silence turns a
 * readiness score, a week of sessions and a training history into a fiction
 * wearing their name. A recovery day they never had. An HRV reading from
 * nobody's wrist.
 *
 * So: `demo` says so plainly and moves on, `empty` says what is missing and
 * what fixes it, and `live` renders nothing at all — a banner on a working app
 * is noise, and noise is what gets ignored the day it matters.
 */
export default function ProvenanceBanner({ provenance }: { provenance: PlanProvenance }) {
  if (provenance.source === 'live') return null;

  const demo = provenance.source === 'demo';

  return (
    <div
      className="card p-4"
      style={{
        borderColor: demo ? 'var(--line)' : 'var(--warn)',
        background: demo ? 'var(--surface)' : 'var(--surface-2)',
      }}
    >
      <p className="label" style={{ color: demo ? 'var(--ink-3)' : 'var(--warn)' }}>
        {demo ? 'Demo data' : 'This is not your data yet'}
      </p>

      {demo ? (
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
          No database is configured, so the numbers below are a worked example. Everything
          works — it just is not about you.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
            You are signed in, but nothing has been loaded into your database yet, so the
            readiness score, the history and the week below are a worked example. Nothing
            here is a record of anything you did.
          </p>
          <ul className="mt-3 space-y-1 text-sm" style={{ color: 'var(--ink-2)' }}>
            {provenance.missing.includes('program') && <li>· Your program and gyms are not loaded</li>}
            {provenance.missing.includes('oura') && <li>· No Oura nights have synced</li>}
            {provenance.missing.includes('history') && <li>· No sessions logged — true on day one</li>}
          </ul>
          <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>
            Fixed by running the seed once from a terminal. The steps are in{' '}
            <code>docs/WHERE-WE-ARE.md</code>.
          </p>
        </>
      )}

      <Link href="/settings" className="btn tap mt-3 w-full">
        Setup
      </Link>
    </div>
  );
}
