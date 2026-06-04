'use client';

import { useState, useId } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { Aurora } from './aurora';

// Sign-up form. Magic-link by default with a toggle for "use a password
// instead" — the same toggle the legacy /signup/ surface had. POSTs to
// /api/auth/signup on the root project; same HMAC secret signs the
// session cookie so /app/* recognises the new account once the email
// link is clicked.

type State = 'idle' | 'sending' | 'sent' | 'error';

export function SignupForm() {
  const [email, setEmail] = useState('');
  const [withPassword, setWithPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const emailId = useId();
  const pwId = useId();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    const normalised = email.trim().toLowerCase();
    if (!normalised) {
      setState('error');
      setErrorMsg('Email address required.');
      return;
    }
    if (withPassword && password.length < 12) {
      setState('error');
      setErrorMsg('Password must be at least 12 characters.');
      return;
    }
    setState('sending');
    setErrorMsg('');
    try {
      const body: Record<string, string> = {
        email: normalised,
        // Land newly-confirmed accounts on the editorial cockpit, not the
        // legacy /account/ page. Server-validated via isSafeReturnTo.
        returnTo: '/app/dashboard',
      };
      if (withPassword) body.password = password;
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        setState('sent');
        return;
      }
      if (res.status === 409 && j && j.reason === 'account-exists') {
        setState('error');
        setErrorMsg('An account already exists for that email. Use the sign-in link below.');
        return;
      }
      setState('error');
      setErrorMsg((j && j.error) || 'Could not start signup.');
    } catch (err) {
      setState('error');
      setErrorMsg(`Network error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  return (
    <div className="relative isolate overflow-hidden">
      <Aurora />
      <div className="relative border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/45 p-8 backdrop-blur-sm sm:p-10">
        <AnimatePresence mode="wait">
          {state === 'sent' ? (
            <motion.div
              key="sent"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <h2 className="font-serif text-[22px] leading-[1.2] text-[var(--color-ivory)]">
                Confirmation email on the way.
              </h2>
              <p className="mt-4 text-[14px] leading-[1.65] text-[var(--color-ivory-dim)]">
                We sent a link to <span className="text-[var(--color-ivory)]">{email}</span>. Click it within fifteen minutes to finalise your account. Nothing is created until you click.
              </p>
              <p className="mt-6 text-[13px] text-[var(--color-ivory-mute)]">
                Did not arrive? Check spam, then{' '}
                <button onClick={() => setState('idle')} className="text-[var(--color-ivory)] underline-offset-2 hover:underline">
                  send it again
                </button>
                .
              </p>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={onSubmit}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-5"
              noValidate
            >
              <div>
                <label htmlFor={emailId} className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                  Email
                </label>
                <input
                  id={emailId}
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full border border-[var(--color-navy-line)] bg-[var(--color-ink)]/50 px-3 py-2.5 text-[15px] text-[var(--color-ivory)] outline-none transition-colors focus:border-[var(--color-ivory)]/45"
                  placeholder="you@company.com"
                />
              </div>

              {withPassword && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <label htmlFor={pwId} className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                    Password (≥ 12 chars)
                  </label>
                  <input
                    id={pwId}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-2 w-full border border-[var(--color-navy-line)] bg-[var(--color-ink)]/50 px-3 py-2.5 text-[15px] text-[var(--color-ivory)] outline-none transition-colors focus:border-[var(--color-ivory)]/45"
                  />
                </motion.div>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--color-ivory-dim)]">
                <input
                  type="checkbox"
                  checked={withPassword}
                  onChange={(e) => setWithPassword(e.target.checked)}
                  className="h-4 w-4 accent-[var(--color-ivory)]"
                />
                Set a password too (magic-link still works)
              </label>

              {state === 'error' && errorMsg && (
                <div className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/[0.08] px-3 py-2 font-mono text-[12px] text-[var(--color-critical)]">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={state === 'sending'}
                className="w-full border border-[var(--color-ivory)] bg-[var(--color-ivory)] px-5 py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-ivory-dim)] disabled:cursor-wait disabled:opacity-60"
              >
                {state === 'sending' ? 'Sending…' : 'Create account'}
              </button>

              <p className="text-center text-[13px] text-[var(--color-ivory-mute)]">
                Already have an account?{' '}
                <Link href="/signin" className="text-[var(--color-ivory)] underline-offset-2 hover:underline">
                  Sign in
                </Link>
              </p>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
