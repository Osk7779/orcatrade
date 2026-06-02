'use client';

import { cn } from '@/lib/utils';

// Magic-UI-style border beam: a hairline gradient sweep that travels
// around a card's perimeter. We use it sparingly — only on the flagship
// pillar in the Bento — so it reads as a distinction, not decoration.
export function BorderBeam({
  className,
  size = 220,
  duration = 14,
  delay = 0,
  colorFrom = 'rgba(250, 250, 247, 0)',
  colorTo = 'rgba(250, 250, 247, 0.7)',
}: {
  className?: string;
  size?: number;
  duration?: number;
  delay?: number;
  colorFrom?: string;
  colorTo?: string;
}) {
  return (
    <div
      aria-hidden
      style={
        {
          '--size': size,
          '--duration': duration,
          '--delay': `-${delay}s`,
          '--color-from': colorFrom,
          '--color-to': colorTo,
        } as React.CSSProperties
      }
      className={cn(
        'pointer-events-none absolute inset-0 [border:calc(var(--size)*0px+1px)_solid_transparent]',
        '![mask-clip:padding-box,border-box] ![mask-composite:intersect] [mask:linear-gradient(transparent,transparent),linear-gradient(white,white)]',
        'after:absolute after:aspect-square after:w-[calc(var(--size)*1px)] after:animate-[border-beam_calc(var(--duration)*1s)_infinite_linear] after:[animation-delay:var(--delay)] after:[background:linear-gradient(to_left,var(--color-from),var(--color-to),transparent)] after:[offset-anchor:90%_50%] after:[offset-path:rect(0_auto_auto_0_round_calc(var(--size)*1px))]',
        className,
      )}
    />
  );
}
