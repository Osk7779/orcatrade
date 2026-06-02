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
}

export interface PricingTier {
  name: string;
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

  return (
    <>
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
