'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice } from '@/components/States';

interface Session {
  id: string;
  ua: string;
  ip?: string;
  city?: string;
  country?: string;
  createdAt?: string;
  lastSeenAt?: string;
  current?: boolean;
}

interface SecurityState {
  hasPassword?: boolean;
  hasMfa?: boolean;
  sessions?: Session[];
}

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function SecurityPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [data, setData] = useState<SecurityState>({});
  const [revoking, setRevoking] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    fetch('/api/account/security', { credentials: 'include' })
      .then((r) => {
        if (r.status === 401) {
          setState('auth');
          return null;
        }
        if (!r.ok) throw new Error(`Security endpoint returned ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d) {
          setData(d);
          setState('ready');
        }
      })
      .catch(() => setState('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(id: string) {
    setRevoking(id);
    setErr('');
    try {
      const res = await fetch('/api/account/security', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke-session', id }),
      });
      if (!res.ok) throw new Error(`Revoke endpoint returned ${res.status}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not revoke that session.');
    } finally {
      setRevoking(null);
    }
  }

  async function revokeAllOthers() {
    setRevoking('__all__');
    setErr('');
    try {
      const res = await fetch('/api/account/security', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke-all-other-sessions' }),
      });
      if (!res.ok) throw new Error(`Revoke-all endpoint returned ${res.status}`);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not revoke other sessions.');
    } finally {
      setRevoking(null);
    }
  }

  if (state === 'loading') return <LoadingNotice label="Loading security settings…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to manage security." />;
  if (state === 'error') return <ErrorNotice />;

  const sessions = data.sessions ?? [];
  const others = sessions.filter((s) => !s.current);

  return (
    <div className="max-w-[820px]">
      <PageHeader
        kicker="Account · security"
        title="Security."
        sub="Sign-in methods, two-factor, and every device that has signed in to your account. Revoke individual sessions to sign out without touching the others."
      />

      {err && (
        <div className="mb-6 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
          <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{err}</p>
        </div>
      )}

      {/* Sign-in methods */}
      <section className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-6 md:p-8">
        <SectionHead kicker="Sign-in methods" />
        <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] sm:grid-cols-2">
          <MethodTile
            title="Magic-link email"
            status="always on"
            statusTone="text-[var(--color-positive)]"
            body="Single-use link to your account email. No passwords to leak, lose or reuse."
          />
          <MethodTile
            title="Password (optional)"
            status={data.hasPassword ? 'set' : 'not set'}
            statusTone={
              data.hasPassword ? 'text-[var(--color-positive)]' : 'text-[var(--color-ivory-mute)]'
            }
            body="Optional second factor for the magic-link flow. Strongly recommended if you share devices."
          />
          <MethodTile
            title="Two-factor (TOTP)"
            status={data.hasMfa ? 'enabled' : 'off'}
            statusTone={
              data.hasMfa ? 'text-[var(--color-positive)]' : 'text-[var(--color-ivory-mute)]'
            }
            body="Time-based one-time password from an authenticator app — Authy, 1Password, Google Authenticator."
          />
          <MethodTile
            title="Passkeys"
            status="coming"
            statusTone="text-[var(--color-warning)]"
            body="WebAuthn passkeys land on Growth and Enterprise plans during the pilot."
          />
        </div>
      </section>

      {/* Active sessions */}
      <section className="mt-10">
        <div className="mb-5 flex items-baseline justify-between gap-3 border-b border-[var(--color-navy-line)] pb-3">
          <SectionHead kicker="Active sessions" />
          {others.length > 1 && (
            <button
              type="button"
              onClick={revokeAllOthers}
              disabled={revoking === '__all__'}
              className="inline-flex items-center gap-2 border border-[var(--color-navy-line)] px-3.5 py-1.5 font-mono text-[11px] font-medium tracking-tight text-[var(--color-ivory-dim)] transition-all duration-300 hover:border-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {revoking === '__all__'
                ? 'Revoking…'
                : `Revoke all other sessions (${others.length})`}
            </button>
          )}
        </div>

        {sessions.length === 0 ? (
          <p className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
            No active sessions found. This usually means you signed in before per-device
            tracking shipped — sign out and sign back in to populate this list.
          </p>
        ) : (
          <div className="border border-[var(--color-navy-line)]">
            {sessions.map((s, i) => (
              <article
                key={s.id}
                className={`relative flex flex-col items-start gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between md:gap-6 md:px-6 md:py-5 ${
                  i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
                } ${s.current ? 'bg-[var(--color-positive)]/[0.04]' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span
                      className="truncate font-serif text-[14.5px] leading-tight text-[var(--color-ivory)]"
                      style={{
                        fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                        fontWeight: 550,
                      }}
                    >
                      {s.ua || 'Unknown device'}
                    </span>
                    {s.current && (
                      <span className="inline-flex items-center gap-1 bg-[var(--color-positive)]/12 px-2 py-0.5 font-mono text-[10.5px] font-medium uppercase tabular-nums tracking-tight text-[var(--color-positive)]">
                        this device
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
                    {s.city ? `${s.city}${s.country ? `, ${s.country}` : ''}` : s.ip ?? 'IP hidden'}
                    {s.lastSeenAt ? ` · last seen ${timeAgo(s.lastSeenAt)}` : ''}
                  </div>
                </div>
                {!s.current && (
                  <button
                    type="button"
                    onClick={() => revoke(s.id)}
                    disabled={revoking === s.id}
                    className="inline-flex shrink-0 items-center gap-1.5 border border-[var(--color-critical)]/30 bg-[var(--color-critical)]/[0.06] px-3 py-1.5 font-mono text-[11px] font-medium tracking-tight text-[var(--color-critical)] transition-colors duration-300 hover:bg-[var(--color-critical)]/12 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {revoking === s.id ? 'Revoking…' : 'Revoke'}
                  </button>
                )}
              </article>
            ))}
          </div>
        )}

        <p className="mt-5 max-w-[60ch] font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
          Per-session revocation invalidates the cookie on the next request, on every
          endpoint that handles sensitive data.
        </p>
      </section>
    </div>
  );
}

function SectionHead({ kicker }: { kicker: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span aria-hidden className="font-serif text-[12.5px] text-[var(--color-ivory-dim)]/60">
        ❦
      </span>
      <span
        className="font-serif text-[1rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        {kicker}
      </span>
    </div>
  );
}

function MethodTile({
  title,
  status,
  statusTone,
  body,
}: {
  title: string;
  status: string;
  statusTone: string;
  body: string;
}) {
  return (
    <article className="flex flex-col gap-3 bg-[var(--color-ink)] p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3
          className="font-serif text-[1rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          {title}
        </h3>
        <span
          className={`font-mono text-[10.5px] font-medium uppercase tabular-nums tracking-tight ${statusTone}`}
        >
          {status}
        </span>
      </div>
      <p className="text-[13.5px] leading-[1.55] text-[var(--color-ivory-dim)]">{body}</p>
    </article>
  );
}
