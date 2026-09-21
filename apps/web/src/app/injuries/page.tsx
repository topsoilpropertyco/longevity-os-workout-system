import InjuryRegister from '@/components/InjuryRegister';
import { getPlanBundle } from '@/lib/plan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Injuries · Longevity OS' };

export default async function InjuriesPage() {
  const { input, today } = await getPlanBundle();

  return (
    <main className="app-pad mx-auto max-w-xl pt-5">
      <header className="mb-4">
        <p className="label">Never tear down</p>
        <h1 className="text-2xl">Injury register</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
          These are hard constraints, not preferences. A 2-point pain rise inside 24 hours regresses the pattern one
          step on its own.
        </p>
      </header>

      <InjuryRegister injuries={input.injuries} todayIso={today} />
    </main>
  );
}
