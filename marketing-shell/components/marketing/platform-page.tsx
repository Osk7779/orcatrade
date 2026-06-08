'use client';

import Link from 'next/link';
import { forwardRef, useRef } from 'react';
import { motion } from 'motion/react';
import { AnimatedBeam } from './animated-beam';
import { Aurora } from './aurora';
import { AmbientParticles } from './ambient-particles';
import { BorderBeam } from './border-beam';
import { ChapterRule } from './chapter-rule';
import { CursorSpotlight } from './cursor-spotlight';
import { EditorialHeader } from './editorial-header';
import { FadeUp } from './fade-up';
import { NumberTicker } from './number-ticker';
import { SparklesText } from './sparkles';
import { cn } from '@/lib/utils';

// /platform — a cinematic, dynamic re-take of the page. Aurora + ambient
// particles wash the hero; an AnimatedBeam diagram flows the five stages
// through a central Operations hub; NumberTicker stats count up on
// scroll; CursorSpotlight + BorderBeam give the moat cards life. Editorial
// rhythm preserved (ChapterRule + FadeUp), but the page now moves.

const STAGES = [
  {
    code: '01',
    kicker: 'Find it',
    title: 'Sourcing.',
    question: 'Which supplier should I order from?',
    answer:
      'Country comparisons grounded in landed-cost math + factory-score signals. Supplier vetting checklists for first-order risk. Concentration-risk diagnostics on existing supplier mix.',
    href: '/sourcing',
  },
  {
    code: '02',
    kicker: 'Prove it',
    title: 'Compliance.',
    question: 'What regulations apply, and what evidence must I collect?',
    answer:
      'CBAM, EUDR, REACH, CE marking, anti-dumping & countervailing duties. Per-shipment applicability, exposure math, ranked actions, every claim cited to verbatim regulation chunks.',
    href: '/compliance',
  },
  {
    code: '03',
    kicker: 'Move it',
    title: 'Logistics.',
    question: 'Cheapest reliable route within my window?',
    answer:
      'Mode + lane + warehouse + insurance recommendation with a deterministic landed-cost quote. Bonded warehouse cash-flow trade-offs surfaced explicitly. Buffer-stock math against transit slip.',
    href: '/logistics',
  },
  {
    code: '04',
    kicker: 'Pay for it',
    title: 'Finance.',
    question: 'What does this cost end-to-end?',
    answer:
      'FX exposure, hedging recommendation, working-capital cycle, total cost of ownership. Per-payment-instrument selection (TT / LC) with the supplier-risk framing baked in.',
    href: '/finance',
  },
  {
    code: '05',
    kicker: 'Run it',
    title: 'Orchestrator.',
    question: 'How do these answers compose for my actual operation?',
    answer:
      "A meta-agent that merges the four specialists' tool surfaces — cross-domain plans that cite their producing tool for every number. Personal context optional, with consent.",
    href: '/agent/orchestrator',
  },
];

const STATS = [
  { value: 14, label: 'Regulatory regimes covered' },
  { value: 45809, label: 'Sanctions designations screened' },
  { value: 658, label: 'Localised SEO guides shipped' },
  { value: 33, label: 'Tools across 5 agents' },
];

const MOAT = [
  {
    title: 'Hong Kong export desk.',
    body: 'Our HK team leads logistics on the export side. Pure-digital forwarders cannot match in-person supplier verification, sample consolidation, or dispute resolution at the SME price point. We can.',
  },
  {
    title: 'EU compliance is the front door, not a sidebar.',
    body: 'CBAM, EUDR, REACH, CE, RoHS, EU AI Act. Most platforms are American-centric and treat EU regs as bolt-ons. Our compliance engine is foundational.',
  },
  {
    title: 'Five agents + an orchestrator.',
    body: 'Sourcing, Compliance, Logistics, Finance, plus the Operations orchestrator. Agents route, execute, and escalate to humans when it matters. Every irreversible action stays human-approved.',
  },
  {
    title: 'Asset-light by design.',
    body: 'No directly operated ships, planes, trucks, or warehouses. We coordinate the partners who already own that capacity. Margins stay healthy and capital requirements bounded.',
  },
  {
    title: 'SME-sized, by choice.',
    body: '€50k–€2M annual import volume, 2–50 shipments per year. Big enough to need help, small enough that DSV and K+N will not return your call. We sit in that gap.',
  },
  {
    title: 'EN / PL / DE.',
    body: 'Every meaningful page lives in EN, PL, and DE. Polish e-commerce founders, German Mittelstand, broader CEE — we speak the languages and the customs systems.',
  },
];

/* ── Atom: a node bubble that can hold a ref for AnimatedBeam ── */
const Node = forwardRef<HTMLDivElement, { children: React.ReactNode; primary?: boolean; className?: string }>(
  function Node({ children, primary, className }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'relative z-10 grid place-items-center border text-center font-mono tracking-tight shadow-[0_4px_20px_rgba(0,0,0,0.45)]',
          primary
            ? 'size-24 bg-[var(--color-ivory)] text-[var(--color-ink)] border-[var(--color-ivory)] font-serif text-[15px]'
            : 'size-16 bg-[var(--color-navy-soft)] text-[var(--color-ivory)] border-[var(--color-navy-line)] text-[10px] uppercase',
          className,
        )}
        style={primary ? { fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 700 } : undefined}
      >
        {children}
      </div>
    );
  },
);

export function PlatformPage() {
  return (
    <>
      {/* ── HERO ────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] pt-20 pb-12 md:pt-28 md:pb-16">
        <Aurora />
        <AmbientParticles />
        <div className="relative mx-auto max-w-[1280px] px-6">
          <EditorialHeader
            kicker="Platform · Asia → Europe"
            title={
              <>
                Five stages,{' '}
                <SparklesText count={6}>one journey.</SparklesText>
                <br className="hidden md:block" /> Find it, prove it, move it, pay for it, run it.
              </>
            }
            lead="OrcaTrade is the import operating system for European SMEs sourcing from Asia. Calculator-grounded across sourcing, compliance, logistics, finance, and orchestration — five products the customer experiences as one workflow."
            meta="Asia ↔ Europe · €50k–€2M annual volume · 2–50 shipments / year"
          />
        </div>
      </section>

      {/* ── LIVE STATS (count-up on scroll) ─────────────── */}
      <section className="border-y border-[var(--color-navy-line)] bg-[var(--color-ink)] py-10">
        <div className="mx-auto max-w-[1280px] grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-navy-line)] border-x border-[var(--color-navy-line)]">
          {STATS.map((s) => (
            <div key={s.label} className="bg-[var(--color-ink)] px-6 py-7 text-center">
              <div
                className="font-serif text-[clamp(2rem,3.4vw+0.4rem,3rem)] leading-none tracking-[-0.022em] text-[var(--color-ivory)]"
                style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 600 }}
              >
                <NumberTicker value={s.value} />
              </div>
              <div className="mt-2 font-mono text-[10.5px] tracking-[0.16em] uppercase text-[var(--color-ivory-mute)]">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── STAGE FLOW DIAGRAM (animated beams into the hub) ── */}
      <ChapterRule numeral="I" label="The five stages" />
      <section className="relative bg-[var(--color-ink)] py-14 md:py-20 overflow-hidden">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp className="mx-auto max-w-[760px] text-center">
            <h2
              className="font-serif text-[clamp(2rem,3.4vw+0.4rem,2.8rem)] leading-[1.1] tracking-[-0.022em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              One platform. Five live agents. One operations hub.
            </h2>
            <p className="mx-auto mt-5 max-w-[58ch] text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              Each stage answers one question. The Operations orchestrator merges
              them into a single workflow — every number cites its producing
              calculator, every claim cites its source.
            </p>
          </FadeUp>

          <StageFlowDiagram />

          {/* Stage detail cards beneath the diagram */}
          <div className="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {STAGES.map((s, i) => (
              <FadeUp key={s.code} delay={i * 0.06}>
                <CursorSpotlight className="h-full">
                  <Link
                    href={s.href}
                    className="group block h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-7 transition-colors duration-500 hover:bg-[var(--color-navy-soft)] hover:border-[var(--color-ivory)]/25"
                  >
                    <div className="flex items-baseline justify-between">
                      <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-[var(--color-ivory-mute)]">
                        Stage {s.code} · {s.kicker}
                      </div>
                      <span
                        aria-hidden
                        className="font-mono text-[14px] text-[var(--color-ivory-mute)] transition-transform duration-500 group-hover:translate-x-0.5"
                      >
                        →
                      </span>
                    </div>
                    <h3
                      className="mt-3 font-serif text-[1.6rem] leading-[1.15] tracking-[-0.018em] text-[var(--color-ivory)]"
                      style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                    >
                      {s.title}
                    </h3>
                    <p className="mt-3 font-serif italic text-[14px] leading-[1.5] text-[var(--color-ivory-mute)]">
                      &ldquo;{s.question}&rdquo;
                    </p>
                    <p className="mt-4 text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                      {s.answer}
                    </p>
                  </Link>
                </CursorSpotlight>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── MOAT (cursor-spotlight cards) ───────────────── */}
      <ChapterRule numeral="II" label="The moat is operational, not technical" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp>
            <p className="max-w-[62ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
              A horizontal AI platform is easy to build and easy to copy. What
              you can&rsquo;t copy: years of supplier data, an HK office, and an
              EU-compliance posture built in from day one.
            </p>
          </FadeUp>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MOAT.map((m, i) => (
              <FadeUp key={m.title} delay={i * 0.05}>
                <CursorSpotlight className="h-full">
                  <div className="h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-6 transition-colors hover:border-[var(--color-ivory)]/30">
                    <div className="font-serif text-[17px] leading-[1.25] tracking-[-0.012em] text-[var(--color-ivory)]"
                      style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 600 }}
                    >
                      {m.title}
                    </div>
                    <p className="mt-3 text-[14px] leading-[1.65] text-[var(--color-ivory-dim)]">
                      {m.body}
                    </p>
                  </div>
                </CursorSpotlight>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── TWO WAYS TO START (BorderBeam-wrapped CTAs) ─── */}
      <ChapterRule numeral="III" label="Two ways to start" />
      <section className="bg-[var(--color-ink)] py-14 md:py-24">
        <div className="mx-auto max-w-[1100px] px-6">
          <div className="grid gap-5 md:grid-cols-2">
            {[
              {
                title: 'Run a free CBAM + EUDR analysis.',
                body: 'Tell us what you import. We check CBAM and EUDR — applicability, exposure math, evidence gaps, ranked actions, every claim cited.',
                cta: 'Start analysis',
                href: '/analysis',
                flagship: false,
              },
              {
                title: 'Build your import plan.',
                body: 'A six-step brief — what, from where, to where, the numbers. We compose the plan: duty, every regime, freight, working capital, end to end.',
                cta: 'Open the wizard',
                href: '/start',
                flagship: true,
              },
            ].map((c, i) => (
              <FadeUp key={c.title} delay={i * 0.05}>
                <div className="relative isolate flex h-full flex-col overflow-hidden border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-7 md:p-8">
                  {c.flagship && (
                    <BorderBeam
                      duration={9}
                      size={220}
                      colorFrom="rgba(250,250,247,0.85)"
                      colorTo="rgba(250,250,247,0)"
                    />
                  )}
                  <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-[var(--color-ivory-mute)]">
                    {c.flagship ? 'Recommended' : 'Free first run'}
                  </div>
                  <h3
                    className="mt-3 font-serif text-[clamp(1.6rem,2vw+0.4rem,2rem)] leading-[1.15] tracking-[-0.018em] text-[var(--color-ivory)]"
                    style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                  >
                    {c.title}
                  </h3>
                  <p className="mt-3 flex-1 text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                    {c.body}
                  </p>
                  <Link
                    href={c.href}
                    className="group mt-6 inline-flex w-fit items-center gap-2 border border-[var(--color-ivory)] bg-[var(--color-ivory)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ink)] transition-colors hover:bg-white"
                  >
                    {c.cta}
                    <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">→</span>
                  </Link>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  StageFlowDiagram
 *
 *  Five stage nodes column on the left, the central "OPERATIONS" hub in
 *  the middle, with AnimatedBeams flowing from each stage into the hub
 *  and one outbound beam to a "Shipped" terminal on the right. The
 *  beams trace continuously, giving the diagram a quiet pulse that
 *  reads as "the platform is alive".
 * ──────────────────────────────────────────────────────────────────── */
function StageFlowDiagram() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const stageRefs = useRef<Array<React.RefObject<HTMLDivElement | null>>>(
    STAGES.map(() => ({ current: null })),
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-15%' }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto mt-14 grid h-[420px] max-w-[940px] grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-y-3 px-2 sm:h-[480px]"
      ref={containerRef}
    >
      {/* Left column: 5 stage codes */}
      <div className="row-span-5 flex flex-col items-center gap-3 sm:gap-5">
        {STAGES.map((s, i) => (
          <Node
            key={s.code}
            ref={(el) => {
              stageRefs.current[i].current = el;
            }}
          >
            {s.code}
          </Node>
        ))}
      </div>

      {/* Spacer */}
      <div className="row-span-5" />

      {/* Centre hub — Operations */}
      <div className="row-span-5 flex flex-col items-center justify-center gap-3">
        <Node ref={hubRef} primary>
          ORCA
        </Node>
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
          Operations
        </span>
      </div>

      {/* Spacer */}
      <div className="row-span-5" />

      {/* Right column: outbound terminal */}
      <div className="row-span-5 flex flex-col items-center justify-center gap-3">
        <Node ref={outRef}>EU</Node>
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
          Shipped
        </span>
      </div>

      {/* Beams: each stage → hub, then hub → terminal */}
      {STAGES.map((s, i) => (
        <AnimatedBeam
          key={s.code}
          containerRef={containerRef}
          fromRef={stageRefs.current[i]}
          toRef={hubRef}
          curvature={(i - (STAGES.length - 1) / 2) * -22}
          duration={4 + i * 0.35}
          delay={i * 0.25}
        />
      ))}
      <AnimatedBeam
        containerRef={containerRef}
        fromRef={hubRef}
        toRef={outRef}
        duration={3.6}
        delay={1.6}
        pathOpacity={1}
        pathWidth={2}
      />
    </motion.div>
  );
}
