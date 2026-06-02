'use client';

import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Cursor-tracked soft ivory halo. Adapted from Aceternity UI's spotlight
// pattern, tuned to be almost imperceptible — just enough to signal that
// the card is alive under the pointer. Wraps any content with relative
// positioning preserved.
export function CursorSpotlight({
  children,
  className,
  radius = 340,
  intensity = 0.06,
}: {
  children: ReactNode;
  className?: string;
  radius?: number;
  intensity?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0, visible: false });

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setPos({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          visible: true,
        });
      }}
      onMouseLeave={() => setPos((p) => ({ ...p, visible: false }))}
      className={cn('relative isolate', className)}
    >
      {children}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-700 ease-out"
        style={{
          opacity: pos.visible ? 1 : 0,
          background: `radial-gradient(${radius}px circle at ${pos.x}px ${pos.y}px, rgba(250, 250, 247, ${intensity}), transparent 72%)`,
        }}
      />
    </div>
  );
}
