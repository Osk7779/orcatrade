'use client';

import Link from 'next/link';
import { EditorialHeader } from './editorial-header';
import { ChapterRule } from './chapter-rule';
import { FadeUp } from './fade-up';
import { Aurora } from './aurora';
import { AmbientParticles } from './ambient-particles';
import { CursorSpotlight } from './cursor-spotlight';
import { BorderBeam } from './border-beam';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

// Shared template for product / domain landing pages. Each page passes
// a config: hero block, optional numbered "how it works" steps, and a
// scenarios block of feature cards. Keeps the 11 domain pages
// (customs / routing / warehouse / insurance / etc.) on one
// consistent visual rhythm — same ChapterRule cadence, same motion,
// same responsive grid.

export interface DomainStep {
  title: string;
  body: string;
}

export interface DomainScenario {
  badge: string;
  title: string;
  body: string;
  bullets?: string[];
  variant?: 'positive' | 'neutral';
}

export interface DomainCTA {
  label: string;
  href: string;
  variant?: 'solid' | 'ghost';
}

export interface DomainLandingProps {
  hero: {
    kicker: string;
    title: ReactNode;
    lead: string;
    meta?: string;
    ctas?: DomainCTA[];
  };
  steps?: {
    label: string;
    intro?: string;
    items: DomainStep[];
  };
  scenarios?: {
    label: string;
    intro?: string;
    items: DomainScenario[];
  };
  closer?: {
    label: string;
    title: string;
    body?: string;
    ctas: DomainCTA[];
  };
}

function CtaButton({ cta, large = false }: { cta: DomainCTA; large?: boolean }) {
  const solid = cta.variant !== 'ghost';
  const padding = large ? 'px-6 py-3' : 'px-5 py-2.5';
  return (
    <Link
      href={cta.href}
      className={`group inline-flex items-center gap-2 border font-mono text-[12px] uppercase tracking-[0.14em] transition-colors ${padding} ${
        solid
          ? 'border-[var(--color-ivory)] bg-[var(--color-ivory)] text-[var(--color-ink)] hover:bg-[var(--color-ivory-dim)]'
          : 'border-[var(--color-ivory)]/45 text-[var(--color-ivory)] hover:border-[var(--color-ivory)] hover:bg-[var(--color-ivory)]/5'
      }`}
    >
      {cta.label}
      <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}

export function DomainLanding({ hero, steps, scenarios, closer }: DomainLandingProps) {
  return (
    <>
      {/* ── Hero: aurora + particles wash behind the editorial header ── */}
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)]">
        <Aurora />
        <AmbientParticles />
        <div className="relative">
          <EditorialHeader kicker={hero.kicker} title={hero.title} lead={hero.lead} meta={hero.meta} />
          {hero.ctas && hero.ctas.length > 0 && (
            <div className="pb-10 md:pb-14">
              <div className="mx-auto flex max-w-[1100px] flex-wrap gap-3 px-6">
                {hero.ctas.map((c) => <CtaButton key={c.label} cta={c} />)}
              </div>
            </div>
          )}
        </div>
      </section>

      {steps && (
        <>
          <ChapterRule numeral="I" label={steps.label} />
          <section className="bg-[var(--color-ink)] py-14 md:py-20">
            <div className="mx-auto max-w-[1100px] px-6">
              {steps.intro && (
                <FadeUp>
                  <p className="max-w-[62ch] text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">{steps.intro}</p>
                </FadeUp>
              )}
              <div className={`grid gap-3 sm:grid-cols-2 ${steps.intro ? 'mt-10' : ''} ${steps.items.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
                {steps.items.map((s, i) => (
                  <FadeUp key={s.title} delay={i * 0.04}>
                    <CursorSpotlight className="h-full">
                      <motion.div
                        initial={{ y: 0 }}
                        whileHover={{ y: -3 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className="group relative isolate h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/25 p-6 transition-colors duration-500 hover:border-[var(--color-ivory)]/25"
                      >
                        {/* Hairline top accent that fills on hover */}
                        <span
                          aria-hidden
                          className="absolute top-0 left-0 h-[2px] w-0 bg-[var(--color-ivory)] transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full"
                        />
                        <div
                          className="font-serif text-[34px] leading-none tracking-[-0.024em] text-[var(--color-ivory)]"
                          style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 600 }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </div>
                        <div className="mt-5 font-serif text-[17px] leading-[1.3] text-[var(--color-ivory)]">{s.title}</div>
                        <p className="mt-3 text-[13.5px] leading-[1.65] text-[var(--color-ivory-dim)]">{s.body}</p>
                      </motion.div>
                    </CursorSpotlight>
                  </FadeUp>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {scenarios && (
        <>
          <ChapterRule numeral={steps ? 'II' : 'I'} label={scenarios.label} />
          <section className="bg-[var(--color-ink)] py-14 md:py-20">
            <div className="mx-auto max-w-[1100px] px-6">
              {scenarios.intro && (
                <FadeUp>
                  <p className="max-w-[62ch] text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">{scenarios.intro}</p>
                </FadeUp>
              )}
              <div className={`grid gap-3 sm:grid-cols-2 ${scenarios.intro ? 'mt-10' : ''} lg:grid-cols-3`}>
                {scenarios.items.map((sc, i) => (
                  <FadeUp key={sc.title} delay={i * 0.05}>
                    <CursorSpotlight className="h-full" intensity={0.07}>
                      <motion.div
                        initial={{ y: 0 }}
                        whileHover={{ y: -3 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className="relative isolate h-full overflow-hidden border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-6 transition-colors hover:border-[var(--color-ivory)]/30"
                      >
                        {sc.variant === 'positive' && (
                          <BorderBeam
                            duration={11}
                            size={180}
                            colorFrom="rgba(16,185,129,0.6)"
                            colorTo="rgba(16,185,129,0)"
                          />
                        )}
                        <span
                          className={`inline-block border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${
                            sc.variant === 'positive'
                              ? 'border-[var(--color-positive)]/45 text-[var(--color-positive)] bg-[var(--color-positive)]/[0.06]'
                              : 'border-[var(--color-ivory-mute)]/40 text-[var(--color-ivory-mute)]'
                          }`}
                        >
                          {sc.badge}
                        </span>
                        <h3
                          className="mt-4 font-serif text-[18px] leading-[1.25] tracking-[-0.012em] text-[var(--color-ivory)]"
                          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 600 }}
                        >
                          {sc.title}
                        </h3>
                        <p className="mt-3 text-[14px] leading-[1.6] text-[var(--color-ivory-dim)]">{sc.body}</p>
                        {sc.bullets && sc.bullets.length > 0 && (
                          <ul className="mt-4 space-y-1.5">
                            {sc.bullets.map((b) => (
                              <li key={b} className="flex gap-2.5 text-[13px] leading-[1.5] text-[var(--color-ivory-dim)]">
                                <span aria-hidden className="mt-1.5 inline-block h-px w-3 shrink-0 bg-[var(--color-ivory-mute)]" />
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </motion.div>
                    </CursorSpotlight>
                  </FadeUp>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {closer && (
        <>
          <ChapterRule numeral={steps && scenarios ? 'III' : steps || scenarios ? 'II' : 'I'} label={closer.label} />
          <section className="relative isolate overflow-hidden bg-[var(--color-ink)] py-20 md:py-28">
            <Aurora />
            <div className="relative mx-auto max-w-[760px] px-6 text-center">
              <FadeUp>
                <h2
                  className="font-serif text-[clamp(1.8rem,2.8vw+0.4rem,2.6rem)] leading-[1.15] tracking-[-0.022em] text-[var(--color-ivory)]"
                  style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                >
                  {closer.title}
                </h2>
                {closer.body && (
                  <p className="mt-6 text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">{closer.body}</p>
                )}
                <div className="mt-10 flex flex-wrap justify-center gap-4">
                  {closer.ctas.map((c) => <CtaButton key={c.label} cta={c} large />)}
                </div>
              </FadeUp>
            </div>
          </section>
        </>
      )}
    </>
  );
}
