'use client';

import { motion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const variants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

// Reveal-on-scroll wrapper. Once-only, generous margin so the reveal
// fires comfortably before the section title enters the viewport.
// Used around section H2s and intros.
export function FadeUp({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'header';
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      variants={variants}
      transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1], delay }}
      className={cn(className)}
    >
      <Tag>{children}</Tag>
    </motion.div>
  );
}
