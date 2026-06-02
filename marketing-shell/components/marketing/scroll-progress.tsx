'use client';

import { motion, useScroll, useSpring } from 'motion/react';

// Hairline progress bar pinned to the top of the header. Reads as a piece
// of editorial chrome (FT, NYT) rather than a UI affordance.
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    mass: 0.4,
  });

  return (
    <motion.div
      aria-hidden
      style={{ scaleX, transformOrigin: '0 0' }}
      className="pointer-events-none absolute inset-x-0 top-0 z-[60] h-px bg-[var(--color-ivory)]/45"
    />
  );
}
