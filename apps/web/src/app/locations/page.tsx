import LocationEditor from '@/components/LocationEditor';
import { getPlanBundle } from '@/lib/plan';
import { LOCATION_PRESETS } from '@/lib/fixtures/demo';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Locations · Longevity OS' };

export default async function LocationsPage() {
  const { input } = await getPlanBundle();

  return (
    <main className="app-pad mx-auto max-w-xl pt-5">
      <header className="mb-4">
        <p className="label">Where you train</p>
        <h1 className="text-2xl">Locations</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
          Each location is a checklist over the equipment catalog. The engine only prescribes what is actually there.
        </p>
      </header>

      <LocationEditor initial={input.all_locations ?? [input.location]} presets={LOCATION_PRESETS} />

      <section className="card mt-6 p-4">
        <h2 className="text-base">Planet Fitness, honestly</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
          No Olympic barbells, racks, platforms, bumper plates or chalk. Smith machines everywhere, counterbalanced to
          roughly 15–20 lb. Dumbbells usually to 75 lb, fixed bars to 60–70, and the full selectorized line. Every
          barbell lift in the library ships with a <code>barbell_free</code> alternative for exactly this reason.
        </p>
      </section>
    </main>
  );
}
