'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { Aurora } from './aurora';
import { Globe } from './globe';
import { SparklesText } from './sparkles';
import { MotionHeadline } from './motion-headline';
import { AmbientParticles } from './ambient-particles';
import { GlobeStars } from './globe-stars';
import { cn } from '@/lib/utils';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

// Cinematic intro orchestrated with the IntroOverlay title plate:
//
//   t=0.0s — page mounts. IntroOverlay covers the viewport with the
//            ORCATRADE GROUP wordmark. Hero is rendering underneath but
//            invisible to the user.
//   t=1.7s — IntroOverlay starts its fade-out (FADE_MS = 600ms there).
//            By now the Hero's MotionHeadline has already paced through
//            "Source it. / Clear it. / Move it. / Finance it." line by
//            line, centred on the viewport, ready to be revealed.
//   t=2.3s — IntroOverlay is fully gone. The headline now sits centred
//            with nothing else around it. A beat.
//   t=3.0s — Phase flips to "settled". Motion's layout animation glides
//            the headline to the left column over ~1.4s. Globe + kicker
//            + body + CTAs fade in to the right and below.
//
// If the user already saw the intro this session (sessionStorage flag),
// the overlay doesn't mount and the hero starts settling sooner.

const INTRO_OVERLAY_TOTAL_MS = 4600; // 4000 hold + 600 fade
const POST_INTRO_BEAT_MS = 700;
const INTRO_MS_FIRST_LOAD = INTRO_OVERLAY_TOTAL_MS + POST_INTRO_BEAT_MS;
const INTRO_MS_REPEAT = 1500;
const SESSION_KEY = 'orcatrade.intro.played.v2';

export function Hero({ copy = EN_COPY.hero }: { copy?: HomepageCopy['hero'] }) {
  const [settled, setSettled] = useState(false);
  const headlineLines = [
    copy.headline[0],
    copy.headline[1],
    copy.headline[2],
    <SparklesText key="finance" count={8}>
      {copy.headline[3]}
    </SparklesText>,
  ];

  useEffect(() => {
    const alreadyShown =
      typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY);
    const wait = alreadyShown ? INTRO_MS_REPEAT : INTRO_MS_FIRST_LOAD;
    const t = setTimeout(() => setSettled(true), wait);
    return () => clearTimeout(t);
  }, []);

  return (
    <section className="relative isolate min-h-[calc(100svh-112px)] overflow-hidden">
      <Aurora />
      <AmbientParticles />

      {/* Layout flips from a centred flex to a 2-column grid. Motion's
          layout prop interpolates the headline's position so it glides
          rather than snaps. */}
      <motion.div
        layout
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          'relative mx-auto max-w-[1280px] px-6',
          settled
            ? 'grid grid-cols-1 items-center gap-12 pt-24 pb-28 md:grid-cols-[1.05fr_0.95fr] md:gap-20 md:pt-32 md:pb-36'
            : 'flex min-h-[calc(100svh-112px)] items-center justify-center',
        )}
      >
        {/* Copy column. During intro, only the headline is visible and
            it's centred. After settle, the kicker / body / CTAs fade in. */}
        <motion.div
          layout
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            'flex flex-col gap-10',
            !settled && 'items-center text-center',
          )}
        >
          {/* Kicker — only appears once we settle */}
          <motion.div
            initial={false}
            animate={{ opacity: settled ? 1 : 0, y: settled ? 0 : 8 }}
            transition={{ duration: 0.9, delay: settled ? 0.6 : 0, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center gap-4"
          >
            <span className="h-px w-10 bg-[var(--color-ivory-dim)]/50" />
            <span className="text-[12px] font-medium tracking-tight text-[var(--color-ivory-dim)]">
              {copy.kicker}
            </span>
          </motion.div>

          {/* The headline carries the whole intro. It mounts immediately
              and its own per-line stagger handles the "line lands" rhythm. */}
          <MotionHeadline
            className={cn(
              'font-serif leading-[1.02] tracking-[-0.02em] text-[var(--color-ivory)]',
              !settled
                ? 'text-[clamp(3.4rem,7.6vw+0.4rem,6.4rem)]'
                : 'text-[clamp(3rem,6.2vw+0.4rem,5.6rem)]',
            )}
            lines={headlineLines}
          />

          {/* Body + CTAs + colophon — fade in once we settle */}
          <motion.div
            initial={false}
            animate={{ opacity: settled ? 1 : 0, y: settled ? 0 : 12 }}
            transition={{ duration: 0.9, delay: settled ? 0.8 : 0, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col gap-10"
          >
            <p className="max-w-[52ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
              {copy.body}
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/start"
                className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-all duration-500 hover:bg-white"
              >
                {copy.ctaPrimary}
                <span
                  aria-hidden
                  className="transition-transform duration-500 group-hover:translate-x-0.5"
                >
                  →
                </span>
              </Link>
              <Link
                href="/docs/orcatrade-shareholder-brief"
                className="group inline-flex items-center gap-3 border border-[var(--color-navy-line)] px-7 py-3.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
              >
                {copy.ctaSecondary}
              </Link>
            </div>

            <div className="flex items-center gap-3.5 pt-4">
              <span className="h-px w-8 bg-[var(--color-ivory-mute)]/40" />
              <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/60">
                ❦
              </span>
              <span className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
                {copy.footer}
              </span>
            </div>
          </motion.div>
        </motion.div>

        {/* Globe column. Only mounted after the headline settles, so it
            doesn't share intro screen-space with the title plate. */}
        {settled && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, x: 32 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.4 }}
            className="relative mx-auto w-full max-w-[640px]"
          >
            <GlobeStars />
            <Globe />
            <div className="mt-8 flex flex-col items-center gap-1.5">
              <span className="font-serif text-[1.05rem] italic leading-tight text-[var(--color-ivory-dim)]">
                {copy.globeCaption}
              </span>
              <span className="text-[11px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
                {copy.globeSubCaption}
              </span>
            </div>
          </motion.div>
        )}
      </motion.div>
    </section>
  );
}
