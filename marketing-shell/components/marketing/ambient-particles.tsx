'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

// Slow drifting motes — dust in candlelight, not snow. Twelve small ivory
// dots animated via CSS keyframes so the hero feels lived-in without any
// JS frame loop. Deterministic seed for hydration safety.
const SEED = [
  { x: 8, y: 22, size: 2.4, dur: 22, delay: 0, drift: 18 },
  { x: 17, y: 68, size: 1.8, dur: 28, delay: 4, drift: -22 },
  { x: 25, y: 38, size: 2.6, dur: 24, delay: 7, drift: 14 },
  { x: 34, y: 12, size: 1.6, dur: 30, delay: 2, drift: -16 },
  { x: 42, y: 78, size: 2.2, dur: 26, delay: 9, drift: 20 },
  { x: 51, y: 52, size: 1.4, dur: 32, delay: 5, drift: -12 },
  { x: 59, y: 18, size: 2.0, dur: 25, delay: 1, drift: 16 },
  { x: 67, y: 84, size: 1.8, dur: 29, delay: 8, drift: -20 },
  { x: 73, y: 32, size: 2.4, dur: 27, delay: 3, drift: 22 },
  { x: 81, y: 64, size: 1.6, dur: 31, delay: 6, drift: -18 },
  { x: 88, y: 14, size: 2.2, dur: 23, delay: 10, drift: 14 },
  { x: 94, y: 46, size: 1.8, dur: 28, delay: 4, drift: -16 },
];

export function AmbientParticles({ className }: { className?: string }) {
  const motes = useMemo(() => SEED, []);
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        className,
      )}
    >
      {motes.map((m, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-[var(--color-ivory)]"
          style={{
            left: `${m.x}%`,
            top: `${m.y}%`,
            width: `${m.size}px`,
            height: `${m.size}px`,
            opacity: 0,
            animation: `mote-drift ${m.dur}s ease-in-out ${m.delay}s infinite`,
            // Pass the horizontal drift as a CSS variable consumed by the
            // keyframes — each mote drifts a different amount and direction.
            ['--drift' as string]: `${m.drift}px`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
