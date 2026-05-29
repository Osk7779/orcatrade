'use client';

import { motion, useScroll, useSpring, useTransform } from 'motion/react';
import { useRef } from 'react';

// Vertical hairline pinned to the left edge of the page that 'fills' as
// the reader progresses through the article. Three dots mark the spine
// at fixed positions to imply chapter anchors without coupling to actual
// DOM positions. Hidden under sm — the margin doesn't exist on mobile.
export function TracingBeam() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const smooth = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    mass: 0.4,
  });
  const scaleY = useTransform(smooth, (v) => v);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-[max(1.5rem,calc((100vw-1280px)/2-2rem))] top-0 z-40 hidden h-screen w-px xl:block"
    >
      {/* Static ghost rail */}
      <span className="absolute inset-0 bg-[var(--color-navy-line)]" />
      {/* Filled portion — tracks scroll, originates at top */}
      <motion.span
        style={{ scaleY, transformOrigin: '0 0' }}
        className="absolute inset-0 bg-gradient-to-b from-[var(--color-ivory)]/55 via-[var(--color-ivory)]/30 to-transparent"
      />
      {/* Three fixed-position anchor dots */}
      {[0.18, 0.5, 0.82].map((p) => (
        <span
          key={p}
          className="absolute -left-[3px] size-[7px] rounded-full border border-[var(--color-ivory-dim)]/40 bg-[var(--color-ink)]"
          style={{ top: `${p * 100}%` }}
        />
      ))}
    </div>
  );
}
