import { notFound } from 'next/navigation';
import SessionRuntime from '@/components/SessionRuntime';
import { getPlanBundle } from '@/lib/plan';
import { swapCandidates } from '@/lib/engine-bridge';
import type { SwapCandidate } from '@/lib/engine-bridge';
import { minutes } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { input, result } = await getPlanBundle();

  const day =
    id === 'today' || id === result.today.date
      ? { session: result.today }
      : result.week.find((d) => d.date === id);

  if (!day) notFound();

  const session = day.session;

  // Candidates are computed on the server so the runtime ships no engine code.
  const swaps: Record<string, SwapCandidate[]> = {};
  for (const block of session.blocks) {
    for (const item of block.exercises) {
      swaps[item.exercise_id] = swapCandidates(item.exercise_id, session, input);
    }
  }

  const next = result.week[1]?.session;

  return (
    <SessionRuntime
      session={session}
      swaps={swaps}
      locationName={input.location.name}
      nextUp={next ? `${next.title} · ${minutes(next.estimated_min)}` : 'Rest'}
    />
  );
}
