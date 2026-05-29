'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice } from '@/components/States';

interface Subscription {
  tier?: string;
  status?: string;
  renewsAt?: string | null;
  cancelsAt?: string | null;
  amountEur?: number | null;
  intervalLabel?: string | null;
  hasPortal?: boolean;
}

function eur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

export default function BillingPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [sub, setSub] = useState<Subscription | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalErr, setPortalErr] = useState('');

  useEffect(() => {
    fetch('/api/account/subscription', { credentials: 'include' })
      .then((r) => {
        if (r.status === 401) {
          setState('auth');
          return null;
        }
        if (!r.ok) throw new Error(`Subscription endpoint returned ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d) {
          setSub(d);
          setState('ready');
        }
      })
      .catch(() => setState('error'));
  }, []);

  async function openPortal() {
    setPortalBusy(true);
    setPortalErr('');
    try {
      const res = await fetch('/api/account/portal', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Portal endpoint returned ${res.status}`);
      const d: { url?: string } = await res.json();
      if (d.url) window.location.href = d.url;
    } catch (e) {
      setPortalErr(e instanceof Error ? e.message : 'Could not open the billing portal.');
    } finally {
      setPortalBusy(false);
    }
  }

  if (state === 'loading') return <LoadingNotice label="Checking your subscription…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to manage billing." />;
  if (state === 'error') return <ErrorNotice />;

  const s = sub ?? {};
  const tierLabel = s.tier
    ? s.tier.charAt(0).toUpperCase() + s.tier.slice(1)
    : 'Founding pilot';
  const status = (s.status || 'pilot').toLowerCase();
  const statusTone =
    status === 'active'
      ? 'text-[var(--color-positive)]'
      : status === 'past_due' || status === 'unpaid'
      ? 'text-[var(--color-critical)]'
      : status === 'canceling' || status === 'cancelled'
      ? 'text-[var(--color-warning)]'
      : 'text-[var(--color-ivory-dim)]';

  return (
    <div className="max-w-[760px]">
      <PageHeader kicker="Account · billing" title="Your subscription." />

      {/* Current plan */}
      <section className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-6 md:p-8">
        <div className="flex items-baseline justify-between gap-4">
          <SectionHead kicker="Current plan" />
          <span
            className={`font-mono text-[11px] font-medium uppercase tabular-nums tracking-tight ${statusTone}`}
          >
            {status.replace(/_/g, ' ')}
          </span>
        </div>
        <div
          className="mt-4 font-serif text-[clamp(2.4rem,3.6vw+0.4rem,3.2rem)] leading-none tracking-[-0.024em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 550 }}
        >
          {tierLabel}
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-3 font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
          {s.amountEur != null && (
            <span>
              <span className="not-italic font-mono font-medium tabular-nums text-[var(--color-ivory)]">
                {eur(s.amountEur)}
              </span>{' '}
              {s.intervalLabel ?? 'per month'}
            </span>
          )}
          {s.renewsAt && <span>· renews {String(s.renewsAt).slice(0, 10)}</span>}
          {s.cancelsAt && (
            <span className="text-[var(--color-warning)]">
              · cancels {String(s.cancelsAt).slice(0, 10)}
            </span>
          )}
        </div>

        {s.hasPortal !== false && (
          <div className="mt-7 flex flex-wrap items-center gap-4 border-t border-[var(--color-navy-line)] pt-6">
            <button
              type="button"
              onClick={openPortal}
              disabled={portalBusy}
              className="group inline-flex items-center gap-2 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {portalBusy ? 'Opening portal…' : 'Manage subscription'}
              {!portalBusy && (
                <span
                  aria-hidden
                  className="transition-transform duration-500 group-hover:translate-x-0.5"
                >
                  ↗
                </span>
              )}
            </button>
            <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
              Opens the secure customer portal · update card, change plan, download receipts
            </span>
          </div>
        )}
        {portalErr && (
          <div className="mt-5 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
            <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">
              {portalErr}
            </p>
          </div>
        )}
      </section>

      <section className="mt-10">
        <SectionHead kicker="What you get on every plan" />
        <ul className="flex flex-col gap-3">
          {[
            'Calculator-grounded import plans across customs, freight, FX and compliance.',
            'Citations on every regulatory claim, with chunk identifiers and confidence tiers.',
            'Live denied-party screening against OFAC SDN, UK OFSI, the UN and the EU consolidated lists.',
            'Audit-chained mutations exportable in one call, independently verifiable.',
            'GDPR-grade data export and erasure, on this page.',
          ].map((line, i) => (
            <li
              key={i}
              className="flex gap-3 text-[14.5px] leading-[1.6] text-[var(--color-ivory-dim)]"
            >
              <span
                aria-hidden
                className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-12 border-t border-[var(--color-navy-line)] pt-6 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
        Founding 10 importers: lifetime 50% off Growth. If you joined the pilot, the
        discount follows your account whatever happens to the public price.
      </p>
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
