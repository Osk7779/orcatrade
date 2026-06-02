'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Documents grid — used on /trust/ to expose every load-bearing
// security & compliance document in the repo. Each card animates in
// on scroll (staggered) and lifts on hover. External-link arrow signals
// "this opens the GitHub source".

export interface DocItem {
  name: string;
  description: string;
  href: string;
}

export function DocumentsGrid({
  items,
  className,
}: {
  items: DocItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-3 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {items.map((doc, i) => (
        <motion.div
          key={doc.name}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-40px' }}
          transition={{ duration: 0.35, delay: i * 0.04 }}
        >
          <Link
            href={doc.href}
            target={doc.href.startsWith('http') ? '_blank' : undefined}
            rel={doc.href.startsWith('http') ? 'noopener noreferrer' : undefined}
            className="group relative block h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-4 transition-all hover:border-[var(--color-ivory)]/35 hover:bg-[var(--color-navy-soft)]/55"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-[12px] font-medium tracking-[0.02em] text-[var(--color-ivory)]">
                {doc.name}
              </span>
              <ArrowUpRight
                aria-hidden
                className="h-3.5 w-3.5 shrink-0 translate-y-[1px] text-[var(--color-ivory-mute)] transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--color-ivory)]"
              />
            </div>
            <p className="mt-2 text-[13px] leading-[1.55] text-[var(--color-ivory-dim)]">
              {doc.description}
            </p>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
