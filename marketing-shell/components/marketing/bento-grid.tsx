'use client';

import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { BorderBeam } from './border-beam';

// 1px gap with a line-coloured background reveals the grid lines between
// cards — the OrcaTrade signature pattern (zero-radius, sharp grid).
export function BentoGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-px bg-[var(--color-navy-line)] md:grid-cols-3',
        // Focus-cards: when any cell is hovered, non-hovered cells dim.
        // Sotheby's-catalogue feel — the eye is guided, not split.
        '[&>*]:transition-opacity [&>*]:duration-700',
        '[&:has(>*:hover)>*:not(:hover)]:opacity-45',
        className,
      )}
    >
      {children}
    </div>
  );
}

interface BentoCardProps {
  className?: string;
  kicker?: string;
  title: ReactNode;
  description: ReactNode;
  cta?: { label: string; href: string };
  visual?: ReactNode;
  status?: 'live' | 'beta' | 'soon';
  span?: 1 | 2;
  rowSpan?: 1 | 2;
  flagship?: boolean;
}

const STATUS_COPY: Record<NonNullable<BentoCardProps['status']>, string> = {
  live: 'Live',
  beta: 'Beta',
  soon: 'Soon',
};

const STATUS_DOT: Record<NonNullable<BentoCardProps['status']>, string> = {
  live: 'bg-[var(--color-positive)]',
  beta: 'bg-[var(--color-info)]',
  soon: 'bg-[var(--color-ivory-mute)]',
};

export function BentoCard({
  className,
  kicker,
  title,
  description,
  cta,
  visual,
  status,
  span = 1,
  rowSpan = 1,
  flagship = false,
}: BentoCardProps) {
  const [spot, setSpot] = useState({ x: 0, y: 0, visible: false });

  return (
    <div
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setSpot({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          visible: true,
        });
      }}
      onMouseLeave={() => setSpot((p) => ({ ...p, visible: false }))}
      className={cn(
        'group relative isolate flex flex-col gap-4 overflow-hidden bg-[var(--color-ink)] p-9 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-10',
        span === 2 && 'md:col-span-2',
        rowSpan === 2 && 'md:row-span-2',
        className,
      )}
    >
      {/* Cursor spotlight overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] transition-opacity duration-700 ease-out"
        style={{
          opacity: spot.visible ? 1 : 0,
          background: `radial-gradient(360px circle at ${spot.x}px ${spot.y}px, rgba(250, 250, 247, 0.06), transparent 72%)`,
        }}
      />

      {/* Optional border beam — flagship card only */}
      {flagship && <BorderBeam size={260} duration={16} />}

      {/* Background visual */}
      {visual && (
        <div className="pointer-events-none absolute inset-0 opacity-50 transition-opacity duration-700 group-hover:opacity-80">
          {visual}
        </div>
      )}

      <div className="relative z-[2] flex h-full flex-col gap-4">
        <div className="flex items-center justify-between">
          {kicker && (
            <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
              {kicker}
            </span>
          )}
          {status && (
            <span className="flex items-center gap-1.5 text-[10.5px] font-medium tracking-tight text-[var(--color-ivory-dim)]">
              <span className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
              {STATUS_COPY[status]}
            </span>
          )}
        </div>
        <h3
          className="font-serif text-[1.7rem] leading-[1.1] tracking-[-0.018em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          {title}
        </h3>
        <p className="max-w-[44ch] text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
          {description}
        </p>
        {cta && (
          <div className="mt-auto pt-5">
            <a
              href={cta.href}
              className="group/cta inline-flex items-center gap-2 text-[13px] font-medium text-[var(--color-ivory)] transition-all duration-500"
            >
              <span className="relative">
                {cta.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/70 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/cta:w-full" />
              </span>
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover/cta:translate-x-0.5"
              >
                →
              </span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
