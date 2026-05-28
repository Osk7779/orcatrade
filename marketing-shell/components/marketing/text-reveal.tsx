'use client';

import { motion, useScroll, useTransform } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Word-by-word reveal as the paragraph scrolls into view. The trigger is
// the container's scroll progress, mapped to each word's opacity range.
// Premium editorial moment — used sparingly (manifesto only).
export function TextReveal({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.6'],
  });

  const words = text.split(' ');

  return (
    <div ref={ref} className={cn('relative', className)}>
      <p className="font-serif text-[clamp(1.4rem,2.6vw+0.4rem,2.4rem)] leading-[1.32] tracking-[-0.012em] text-[var(--color-ivory)]">
        {words.map((word, i) => {
          const start = i / words.length;
          const end = start + 1 / words.length;
          return (
            <Word key={`${word}-${i}`} progress={scrollYProgress} range={[start, end]}>
              {word}
            </Word>
          );
        })}
      </p>
    </div>
  );
}

function Word({
  progress,
  range,
  children,
}: {
  progress: ReturnType<typeof useScroll>['scrollYProgress'];
  range: [number, number];
  children: ReactNode;
}) {
  const opacity = useTransform(progress, range, [0.18, 1]);
  return (
    <span className="relative mr-[0.32em] inline-block">
      <span className="absolute opacity-20">{children}</span>
      <motion.span style={{ opacity }} className="relative italic">
        {children}
      </motion.span>
    </span>
  );
}
