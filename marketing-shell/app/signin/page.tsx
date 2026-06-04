'use client';

import { useState } from 'react';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { Aurora } from '@/components/marketing/aurora';

// Sign-in landing. Magic-link email entry, no password. POSTs to the
// existing /api/auth/magic-link endpoint on the root project. When this
// surface deploys alongside the root project (or under the same domain
// via Vercel rewrites), the magic link is delivered by Resend and the
// session cookie is set on the same origin so the cockpit at /app/* sees
// it directly.

type State = 'idle' | 'sending' | 'sent' | 'error';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value || state === 'sending') return;
    setState('sending');
    setErr('');
    try {
      // The root project's auth dispatcher (lib/handlers/auth.js) lives at
      // /api/auth/<sub-action>. Magic-link issuance is the `request`
      // sub-action; verify / me / logout are siblings. The same secret
      // (ORCATRADE_AUTH_SECRET) signs the session cookie across surfaces
      // so /app/* sees this sign-in immediately.
      // Post-verify destination: send the user straight to the editorial
      // cockpit at /app/dashboard once their magic link succeeds. The
      // verifier validates this server-side via isSafeReturnTo before
      // honouring it, so an attacker can't redirect off-site.
      const res = await fetch('/api/auth/request', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, returnTo: '/app/dashboard' }),
      });
      if (!res.ok) throw new Error(`Sign-in endpoint returned ${res.status}`);
      setState('sent');
    } catch (e) {
      setState('error');
      setErr(e instanceof Error ? e.message : 'Could not send the sign-in link.');
    }
  }

  return (
    <>
      <EditorialHeader
        kicker="Sign in"
        title="Welcome back to OrcaTrade Group."
        lead="No password. We email you a single-use sign-in link valid for fifteen minutes. The session that follows is first-party, same-site strict, and rotates on privilege escalation."
        meta="Magic-link only · session cookie first-party · GDPR-compatible"
      />

      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] py-20 md:py-28">
        <Aurora />
        <div className="relative mx-auto max-w-[560px] px-6">
          {state === 'sent' ? (
            <SentNotice email={email} onReset={() => setState('idle')} />
          ) : (
            <div className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-7 md:p-9">
              <form onSubmit={submit} className="flex flex-col gap-5">
                <label htmlFor="email" className="flex flex-col gap-2">
                  <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
                    Your account email
                  </span>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    autoFocus
                    className="border-b border-[var(--color-navy-line)] bg-transparent px-1 py-3 text-[15px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
                  />
                </label>

                <button
                  type="submit"
                  disabled={state === 'sending' || !email.trim()}
                  className="group inline-flex items-center justify-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {state === 'sending' ? 'Sending the link…' : 'Send me a sign-in link'}
                  {state !== 'sending' && (
                    <span
                      aria-hidden
                      className="transition-transform duration-500 group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  )}
                </button>

                {state === 'error' && err && (
                  <div className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-3">
                    <p className="font-serif text-[13.5px] italic text-[var(--color-ivory)]">
                      {err}
                    </p>
                  </div>
                )}

                <p className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                  No password to leak, lose or reuse. We will never ask for one.
                </p>
              </form>
            </div>
          )}

          <p className="mt-8 text-center font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
            New here?{' '}
            <Link
              href="/signup"
              className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
            , apply for a{' '}
            <Link
              href="/founding"
              className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
            >
              Founding 10 spot
            </Link>
            , or{' '}
            <Link
              href="/start"
              className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
            >
              build a plan without one
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}

function SentNotice({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <div className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-8 text-center md:p-10">
      <div className="flex items-center justify-center gap-3">
        <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/65">
          ❦
        </span>
        <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
          Link on its way
        </span>
      </div>
      <h2
        className="mx-auto mt-6 max-w-[24ch] font-serif text-[clamp(1.8rem,3vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        Check your inbox.
      </h2>
      <p className="mx-auto mt-5 max-w-[44ch] font-serif text-[15px] italic leading-[1.55] text-[var(--color-ivory-dim)]">
        We have sent a single-use sign-in link to{' '}
        <span className="not-italic font-medium text-[var(--color-ivory)]">{email}</span>.
        The link is valid for fifteen minutes.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-2 border border-[var(--color-navy-line)] px-5 py-2.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
        >
          Use a different email
        </button>
        <Link
          href="/contact"
          className="font-serif text-[12.5px] italic text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
        >
          Did not arrive? Tell us →
        </Link>
      </div>
    </div>
  );
}
