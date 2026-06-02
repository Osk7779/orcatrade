import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

// Pure-CSS infinite marquee. Children are duplicated so the loop is seamless.
// Used for the trade-news ticker and (later) the "Trusted by" logo strip.
export function Marquee({
  children,
  className,
  reverse = false,
  pauseOnHover = true,
  durationMs = 50_000,
  fade = true,
}: {
  children: ReactNode;
  className?: string;
  reverse?: boolean;
  pauseOnHover?: boolean;
  durationMs?: number;
  fade?: boolean;
}) {
  return (
    <div
      className={cn(
        'group relative flex w-full overflow-hidden',
        fade &&
          '[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]',
        className,
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center gap-12 pr-12 will-change-transform',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
        )}
        style={{
          animation: `marquee-scroll ${durationMs}ms linear infinite ${reverse ? 'reverse' : ''}`,
        }}
      >
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          'flex shrink-0 items-center gap-12 pr-12 will-change-transform',
          pauseOnHover && 'group-hover:[animation-play-state:paused]',
        )}
        style={{
          animation: `marquee-scroll ${durationMs}ms linear infinite ${reverse ? 'reverse' : ''}`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
