'use client';

import Link from 'next/link';
import { useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { BorderBeam } from './border-beam';

// Pricing tier card grid with a Monthly / Annual billing toggle.
// The toggle is sticky to this component (client-only) so the rest of
// the page stays server-rendered. Most-Popular tier wears a BorderBeam.

interface CTA {
  label: string;
  href: string;
  variant: 'solid' | 'ghost';
  // When true, the CTA opens Stripe Checkout via /api/billing/checkout
  // instead of doing a plain navigation. tierId on the tier identifies
  // the SKU. Unauthenticated visitors are bounced to /signin?return=…
  // so they come back here ready to subscribe.
  checkout?: boolean;
}

export interface PricingTier {
  name: string;
  tierId?: string;
  who: string;
  priceMonthly: string;
  priceAnnual?: string;
  priceUnit?: string;
  note?: string;
  annualNote?: string;
  popular?: boolean;
  cta: CTA;
  features: string[];
}

export function PricingTiers({ tiers }: { tiers: PricingTier[] }) {
  const [annual, setAnnual] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout(tier: PricingTier) {
    if (!tier.tierId) return;
    setPending(tier.tierId);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tierId: tier.tierId,
          billingCycle: annual ? 'annual' : 'monthly',
        }),
      });
      // Sign-in gate: bounce to /signin?return=/pricing?subscribe=tierId
      // so the user resumes the same checkout intent after authentication.
      if (res.status === 401) {
        const ret = encodeURIComponent(`/pricing?subscribe=${tier.tierId}&cycle=${annual ? 'annual' : 'monthly'}`);
        window.location.href = `/signin?return=${ret}`;
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || `Checkout failed (${res.status})`);
      }
      // Hand off to Stripe Checkout.
      window.location.href = data.url as string;
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : 'Could not start checkout. Please try again.');
    }
  }

  // On mount: auto-resume checkout if the URL has ?subscribe=<tierId>
  // (set when we bounced through /signin). Runs once.
  if (typeof window !== 'undefined') {
    // useState initialiser would be cleaner but we need the tiers prop;
    // a one-shot effect-style guard via a flag on window works fine here.
    const w = window as unknown as { __orcaResumed?: boolean };
    if (!w.__orcaResumed) {
      w.__orcaResumed = true;
      const params = new URLSearchParams(window.location.search);
      const want = params.get('subscribe');
      const cycle = params.get('cycle');
      if (want) {
        if (cycle === 'annual') setAnnual(true);
        const tier = tiers.find((t) => t.tierId === want);
        if (tier && tier.cta.checkout) {
          // Defer slightly so React mounts before redirect.
          setTimeout(() => startCheckout(tier), 0);
        }
      }
    }
  }

  return (
    <>
      {error && (
        <div className="mx-auto mb-6 max-w-[640px] border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 px-4 py-3 text-center">
          <p className="font-serif text-[13.5px] italic text-[var(--color-ivory)]">
            {error}
          </p>
        </div>
      )}
      {/* Billing toggle — accessible, keyboard-navigable, motion-soft */}
      <div className="flex justify-center">
        <div
          role="tablist"
          aria-label="Billing cadence"
          className="relative inline-flex items-center gap-1 border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/50 p-1 font-mono text-[12px] uppercase tracking-[0.1em]"
        >
          <button
            role="tab"
            aria-selected={!annual}
            onClick={() => setAnnual(false)}
            className={cn(
              'relative z-10 px-4 py-2 transition-colors',
              !annual ? 'text-[var(--color-ink)]' : 'text-[var(--color-ivory-dim)]',
            )}
          >
            Monthly
          </button>
          <button
            role="tab"
            aria-selected={annual}
            onClick={() => setAnnual(true)}
            className={cn(
              'relative z-10 flex items-center gap-2 px-4 py-2 transition-colors',
              annual ? 'text-[var(--color-ink)]' : 'text-[var(--color-ivory-dim)]',
            )}
          >
            Annual
            <span className="rounded-sm border border-current px-1.5 py-0.5 text-[9px] font-normal">
              2 months free
            </span>
          </button>
          <motion.span
            aria-hidden
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="absolute inset-y-1 bg-[var(--color-ivory)]"
            style={{
              left: annual ? '50%' : 4,
              right: annual ? 4 : '50%',
            }}
          />
        </div>
      </div>

      {/* Tier grid — single column mobile, two columns tablet, five columns wide desktop */}
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {tiers.map((tier, i) => {
          const showAnnual = annual && tier.priceAnnual;
          const displayPrice = showAnnual ? tier.priceAnnual : tier.priceMonthly;
          const displayUnit = showAnnual
            ? '/ month, billed annually'
            : tier.priceUnit
              ? tier.priceUnit
              : '/ month';
          const displayNote = showAnnual ? tier.annualNote : tier.note;
          const isHeadline = tier.popular;

          return (
            <motion.div
              key={tier.name}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
              className={cn(
                'relative flex flex-col border bg-[var(--color-navy-soft)]/35 p-6 transition-colors',
                isHeadline
                  ? 'border-[var(--color-ivory)]/35'
                  : 'border-[var(--color-navy-line)] hover:border-[var(--color-ivory)]/25',
              )}
            >
              {isHeadline && <BorderBeam size={160} duration={8} className="rounded-none" />}
              {isHeadline && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 border border-[var(--color-ivory)]/40 bg-[var(--color-ink)] px-3 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--color-ivory)]">
                  Most popular
                </div>
              )}

              <div className="font-serif text-[22px] leading-[1.1] text-[var(--color-ivory)]">
                {tier.name}
              </div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--color-ivory-mute)]">
                {tier.who}
              </div>

              <div className="mt-6">
                <div className="font-serif text-[34px] leading-none text-[var(--color-ivory)]">
                  {displayPrice}
                  {displayUnit && (
                    <span className="ml-1 align-middle font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-ivory-mute)]">
                      {displayUnit}
                    </span>
                  )}
                </div>
                {displayNote && (
                  <div className="mt-1.5 text-[12px] text-[var(--color-ivory-mute)]">
                    {displayNote}
                  </div>
                )}
              </div>

              {tier.cta.checkout ? (
                <button
                  type="button"
                  onClick={() => startCheckout(tier)}
                  disabled={pending === tier.tierId}
                  className={cn(
                    'mt-6 block w-full border px-4 py-2.5 text-center font-mono text-[12px] uppercase tracking-[0.12em] transition-colors disabled:cursor-progress disabled:opacity-60',
                    tier.cta.variant === 'solid'
                      ? 'border-[var(--color-ivory)] bg-[var(--color-ivory)] text-[var(--color-ink)] hover:bg-[var(--color-ivory-dim)]'
                      : 'border-[var(--color-ivory)]/40 text-[var(--color-ivory)] hover:border-[var(--color-ivory)]',
                  )}
                >
                  {pending === tier.tierId ? 'Opening checkout…' : tier.cta.label}
                </button>
              ) : (
                <Link
                  href={tier.cta.href}
                  className={cn(
                    'mt-6 block w-full border px-4 py-2.5 text-center font-mono text-[12px] uppercase tracking-[0.12em] transition-colors',
                    tier.cta.variant === 'solid'
                      ? 'border-[var(--color-ivory)] bg-[var(--color-ivory)] text-[var(--color-ink)] hover:bg-[var(--color-ivory-dim)]'
                      : 'border-[var(--color-ivory)]/40 text-[var(--color-ivory)] hover:border-[var(--color-ivory)]',
                  )}
                >
                  {tier.cta.label}
                </Link>
              )}

              <ul className="mt-7 space-y-2.5 border-t border-[var(--color-navy-line)] pt-5">
                {tier.features.map((f) => (
                  <li
                    key={f}
                    className="flex gap-2.5 text-[13px] leading-[1.5] text-[var(--color-ivory-dim)]"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 inline-block h-px w-3 shrink-0 bg-[var(--color-ivory-mute)]"
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          );
        })}
      </div>
    </>
  );
}
