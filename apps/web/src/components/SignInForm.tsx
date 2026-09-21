'use client';

import { useState } from 'react';
import { browserSupabase } from '@/lib/supabase/browser';

type Phase = 'ask' | 'sending' | 'sent';

/**
 * Magic-link sign-in. One field, one button, no password to remember and none
 * to lose.
 *
 * Email OTP is on Supabase's free tier, so this costs nothing, and the refresh
 * token it leaves behind is renewed by middleware on every request — one tap on
 * the phone is the last time he should ever see this screen.
 */
export default function SignInForm({ initialError, next }: { initialError?: string; next?: string }) {
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('ask');
  const [error, setError] = useState(initialError ?? '');

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;

    setError('');
    setPhase('sending');

    const supabase = browserSupabase();
    if (!supabase) {
      setError('This build has no Supabase keys, so there is nothing to sign in to.');
      setPhase('ask');
      return;
    }

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        // Absolute, and read from the browser rather than from an env var: the
        // preview deployment, the production domain and localhost all send you
        // back to the origin you actually asked from. Each one still has to be
        // on Supabase's redirect allow-list.
        emailRedirectTo: `${window.location.origin}/auth/callback${
          next ? `?next=${encodeURIComponent(next)}` : ''
        }`,
      },
    });

    if (sendError) {
      setError(sendError.message);
      setPhase('ask');
      return;
    }
    setPhase('sent');
  };

  const field = 'tap mt-1 w-full rounded-xl border bg-transparent px-3 text-base';
  const fieldStyle = { borderColor: 'var(--line)', color: 'var(--ink)' } as const;

  // One idea per screen, and this one is short — so it sits in the middle of the
  // phone rather than stranded under the notch above 400px of nothing.
  const pane = 'app-pad flex flex-1 flex-col justify-center pb-32 pt-8';

  const ready = Boolean(email.trim()) && phase !== 'sending';

  return (
    <div className="flex min-h-full flex-col">
      <div className={pane}>
        {phase === 'sent' ? (
          <section className="animate-rise-in">
            <p className="label">Almost in</p>
            <h1 className="mt-2 text-[2rem] leading-tight">Check your email.</h1>
            <p className="mt-3 text-sm" style={{ color: 'var(--ink-2)' }}>
              A sign-in link is on its way to <span className="font-semibold">{email.trim()}</span>. Open it on this
              phone and you land straight on today&rsquo;s session.
            </p>
            <p className="mt-3 text-xs" style={{ color: 'var(--ink-3)' }}>
              The link is good for one use and about an hour. Nothing else to set up — after this the app keeps you
              signed in.
            </p>

            <button
              type="button"
              className="btn tap mt-6 w-full"
              onClick={() => {
                setPhase('ask');
                setError('');
              }}
            >
              Use a different address
            </button>
          </section>
        ) : (
          <section className="animate-rise-in">
            <p className="label">Longevity OS</p>
            <h1 className="mt-2 text-[2rem] leading-tight">Sign in to see your own data.</h1>
            <p className="mt-3 text-sm" style={{ color: 'var(--ink-2)' }}>
              No password. We email you a link, you tap it once, and the app stays signed in from then on.
            </p>

            <form id="sign-in" onSubmit={send} className="mt-7">
              <label className="block">
                <span className="label">Email</span>
                <input
                  type="email"
                  name="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={field}
                  style={fieldStyle}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'sign-in-error' : undefined}
                />
              </label>
            </form>

            {error && (
              <p id="sign-in-error" role="alert" className="mt-3 text-sm" style={{ color: 'var(--bad)' }}>
                {error}
              </p>
            )}

            <p className="mt-6 text-xs" style={{ color: 'var(--ink-3)' }}>
              Your training data is yours alone — every row in the database is locked to your account by the database
              itself, not by this screen.
            </p>
          </section>
        )}
      </div>

      {phase !== 'sent' && (
        <div className="thumb-bar">
          <div className="mx-auto max-w-xl">
            {/*
              Not a faded orange when there is nothing to send: a washed-out
              primary reads as broken, a plain pill reads as "not yet".
            */}
            <button
              type="submit"
              form="sign-in"
              className={`btn btn-lg${ready ? ' btn-primary' : ''}`}
              disabled={!ready}
              {...(ready ? {} : { style: { color: 'var(--ink-3)' } })}
            >
              {phase === 'sending' ? 'Sending…' : 'Email me a link'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
