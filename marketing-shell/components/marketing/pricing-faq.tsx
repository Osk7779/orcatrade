'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

// Pricing FAQ accordion. Editorial-rule divider between rows, plus icon
// that rotates on expand, smooth height/opacity transition for the body.
// One-at-a-time expansion by default — keeps the page scannable.

export interface FaqEntry {
  q: string;
  a: string;
}

export function PricingFaq({ entries }: { entries: FaqEntry[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="divide-y divide-[var(--color-navy-line)] border-t border-b border-[var(--color-navy-line)]">
      {entries.map((entry, i) => {
        const isOpen = open === i;
        return (
          <div key={entry.q}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
              className="flex w-full items-center justify-between gap-6 py-5 text-left transition-colors hover:text-[var(--color-ivory)]"
            >
              <span className="font-serif text-[17px] leading-[1.35] text-[var(--color-ivory)]">
                {entry.q}
              </span>
              <motion.span
                aria-hidden
                animate={{ rotate: isOpen ? 45 : 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center border text-[16px] leading-none transition-colors',
                  isOpen
                    ? 'border-[var(--color-ivory)] text-[var(--color-ivory)]'
                    : 'border-[var(--color-ivory-mute)] text-[var(--color-ivory-mute)]',
                )}
              >
                +
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <p className="pb-6 pr-12 text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
                    {entry.a}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
