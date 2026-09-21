import { redirect } from 'next/navigation';
import SignInForm from '@/components/SignInForm';
import { getViewer } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in · Longevity OS' };

/** What the callback route is allowed to say went wrong, in his words. */
const REASONS: Record<string, string> = {
  expired: 'That link had already been used, or it timed out. Here is a fresh one.',
  mismatch:
    'That link was opened in a different browser from the one that asked for it. Open it in Safari on the phone you requested it from, or send yourself a new one from here.',
  failed: 'Something went wrong finishing the sign-in. Sending a new link almost always fixes it.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const viewer = await getViewer();

  // Demo mode has no accounts to sign in to, and a signed-in athlete has no
  // reason to be here — both belong on the today card.
  if (viewer.kind !== 'anonymous') redirect('/');

  const params = await searchParams;
  // Only ever a path on this app. An open redirect here would turn a sign-in
  // link into a way to land him on somebody else's page holding a fresh session.
  const next = params.next?.startsWith('/') && !params.next.startsWith('//') ? params.next : undefined;
  const initialError = params.reason ? (REASONS[params.reason] ?? REASONS.failed) : undefined;

  return <SignInForm {...(next ? { next } : {})} {...(initialError ? { initialError } : {})} />;
}
