'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

// Shared editorial card for hub indexes (/examples, /guides, /guides/*).
// Sharp corners, hairline gridline edges, italic-serif kicker, large
// serif title, optional muted-italic metric or detail line, cursor
// spotlight on hover. Click-through to the deep page.
export interface HubCardProps {
  href: string;
  kicker?: string;
  title: string;
  description?: string;
  detail?: string;
  className?: string;
}

export function HubCard({
  href,
  kicker,
  title,
  description,
  detail,
  className,
}: HubCardProps) {
  const [spot, setSpot] = useState({ x: 0, y: 0, visible: false });

  return (
    <Link
      href={href}
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
        'group relative isolate flex flex-col gap-4 overflow-hidden bg-[var(--color-ink)] p-7 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-9',
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] transition-opacity duration-700 ease-out"
        style={{
          opacity: spot.visible ? 1 : 0,
          background: `radial-gradient(280px circle at ${spot.x}px ${spot.y}px, rgba(250, 250, 247, 0.055), transparent 72%)`,
        }}
      />

      {kicker && (
        <span className="relative z-[2] font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
          {kicker}
        </span>
      )}

      <h3
        className="relative z-[2] font-serif text-[clamp(1.2rem,1.6vw+0.4rem,1.55rem)] leading-[1.15] tracking-[-0.014em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        {title}
      </h3>

      {description && (
        <p className="relative z-[2] max-w-[42ch] text-[14px] leading-[1.6] text-[var(--color-ivory-dim)]">
          {description}
        </p>
      )}

      {detail && (
        <span className="relative z-[2] mt-auto pt-3 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
          {detail}
        </span>
      )}

      <span className="relative z-[2] inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-ivory)] opacity-0 transition-opacity duration-500 group-hover:opacity-100">
        Read →
      </span>
    </Link>
  );
}
