'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Hero-tier headline. Each line eases up on first paint with a staggered
// delay so the page feels considered, not loaded. Curve is the same
// expo-out used by the scroll progress and animated beams — one motion
// language across the whole shell.
export function MotionHeadline({
  lines,
  className,
}: {
  lines: ReactNode[];
  className?: string;
}) {
  return (
    <h1 className={cn('flex flex-col', className)}>
      {lines.map((line, i) => (
        <motion.span
          key={i}
          className="block overflow-hidden"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: 0.18 + i * 0.16,
            duration: 1.05,
            ease: [0.16, 1, 0.3, 1],
          }}
        >
          {line}
        </motion.span>
      ))}
    </h1>
  );
}
