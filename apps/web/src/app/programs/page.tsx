import { getPlanBundle } from '@/lib/plan';
import { ago } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Program · Longevity OS' };

export default async function ProgramsPage() {
  const { input } = await getPlanBundle();
  const program = input.program;
  const progress = input.program_progress;

  if (!program) {
    return (
      <main className="app-pad mx-auto max-w-xl pt-5">
        <h1 className="text-2xl">No active program</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ink-2)' }}>
          The longevity engine fills the whole week on its own. A program simply claims two or three of those slots.
        </p>
      </main>
    );
  }

  const met = progress?.met ?? {};
  const current = new Set(progress?.current_step_ids ?? []);
  const metCount = Object.keys(met).length;
  const pct = Math.round((metCount / program.steps.length) * 100);

  return (
    <main className="app-pad mx-auto max-w-xl pt-5">
      <header>
        <p className="label">Active program</p>
        <h1 className="text-2xl">{program.name}</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
          {program.description}
        </p>
      </header>

      <section className="card mt-4 p-4">
        <div className="flex items-baseline justify-between">
          <span className="label">Cycle</span>
          <span className="num text-sm font-semibold">
            {progress?.cycle ?? 1} of {program.target_cycles}
          </span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-2)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--ink-3)' }}>
          {metCount} of {program.steps.length} standards met · ordering is strictly {program.ordering.replace('_', ' ')}
        </p>
      </section>

      {program.blocks
        .sort((a, b) => a.order - b.order)
        .map((block) => (
          <section key={block.id} className="mt-5">
            <h2 className="label">{block.name}</h2>
            <ul className="mt-2 space-y-2">
              {program.steps
                .filter((s) => s.block === block.id)
                .sort((a, b) => a.order - b.order)
                .map((step) => {
                  const evidence = met[step.id];
                  const isCurrent = current.has(step.id);
                  return (
                    <li
                      key={step.id}
                      className="card p-3"
                      style={{ borderColor: isCurrent ? 'var(--accent)' : 'var(--line)' }}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold">
                          {step.order}. {step.name}
                        </span>
                        <span
                          className="shrink-0 text-[0.625rem] font-bold uppercase tracking-wide"
                          style={{ color: evidence ? 'var(--good)' : isCurrent ? 'var(--accent)' : 'var(--ink-3)' }}
                        >
                          {evidence ? '✓ Met' : isCurrent ? 'Current' : 'Locked'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm" style={{ color: 'var(--ink-2)' }}>
                        {step.standard_text}
                      </p>
                      {evidence && (
                        <p className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
                          {evidence.evidence} · {ago(evidence.date, input.today)}
                        </p>
                      )}
                      {step.substitutions?.map((sub) => (
                        <p key={sub.use_slug} className="mt-1 text-xs" style={{ color: 'var(--ink-3)' }}>
                          No {sub.equipment_missing.replace(/_/g, ' ')}? {sub.note ?? sub.use_slug}
                        </p>
                      ))}
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}

      <p className="mt-6 text-xs" style={{ color: 'var(--ink-3)' }}>
        {program.attribution} · normalized from {program.source}
      </p>
    </main>
  );
}
