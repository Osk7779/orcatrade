'use client';

import { forwardRef, useRef } from 'react';
import { AnimatedBeam } from './animated-beam';
import { FadeUp } from './fade-up';
import { cn } from '@/lib/utils';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

const ORIGINS = ['CN', 'VN', 'IN', 'BD', 'TR'];
const DESTINATIONS = ['DE', 'FR', 'NL', 'PL', 'ES', 'IT'];

const Node = forwardRef<
  HTMLDivElement,
  { children: React.ReactNode; className?: string; primary?: boolean }
>(({ children, className, primary }, ref) => (
  <div
    ref={ref}
    className={cn(
      'z-10 grid place-items-center rounded-full bg-white text-[11px] font-semibold text-[var(--color-ivory)] shadow-[0_2px_12px_rgba(0,0,0,0.08)] ring-1 ring-[var(--color-navy-line)] sm:text-[12px]',
      primary
        ? 'size-14 bg-[var(--color-accent)] text-[15px] text-white ring-0 sm:size-16'
        : 'size-10 sm:size-12',
      className,
    )}
  >
    {children}
  </div>
));
Node.displayName = 'Node';

export function StoryBeam({ copy = EN_COPY.storyBeam }: { copy?: HomepageCopy['storyBeam'] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const originRefs = useRef(ORIGINS.map(() => ({ current: null as HTMLDivElement | null })));
  const destinationRefs = useRef(DESTINATIONS.map(() => ({ current: null as HTMLDivElement | null })));

  return (
    <section
      id="platform"
      className="relative bg-[var(--color-navy)] py-20 md:py-24"
    >
      <div className="mx-auto max-w-[1080px] px-6">
        <FadeUp className="mx-auto max-w-[760px] text-center">
          <h2 className="text-[clamp(2rem,4vw,3rem)] leading-[1.1]">
            {copy.title[0]}
            <br className="hidden md:block" /> {copy.title[1]}
          </h2>
          <p className="mx-auto mt-5 max-w-[56ch] text-[17px] leading-[1.5] text-[var(--color-ivory-mute)]">
            {copy.body}
          </p>
        </FadeUp>

        <div
          ref={containerRef}
          className="relative mx-auto mt-16 grid h-[360px] max-w-[940px] grid-cols-[auto_1fr_auto] items-center px-1 sm:h-[440px] sm:px-2"
        >
          <div className="flex flex-col items-center gap-3 sm:gap-5">
            {ORIGINS.map((code, i) => (
              <Node
                key={code}
                ref={(el) => {
                  originRefs.current[i].current = el;
                }}
              >
                {code}
              </Node>
            ))}
          </div>

          <div className="flex h-full items-center justify-center">
            <Node ref={hubRef} primary>
              O
            </Node>
          </div>

          <div className="flex flex-col items-center gap-3 sm:gap-5">
            {DESTINATIONS.map((code, i) => (
              <Node
                key={code}
                ref={(el) => {
                  destinationRefs.current[i].current = el;
                }}
              >
                {code}
              </Node>
            ))}
          </div>

          {ORIGINS.map((code, i) => (
            <AnimatedBeam
              key={`o-${code}`}
              containerRef={containerRef}
              fromRef={originRefs.current[i]}
              toRef={hubRef}
              curvature={(i - (ORIGINS.length - 1) / 2) * -20}
              duration={4 + i * 0.4}
              delay={i * 0.3}
            />
          ))}

          {DESTINATIONS.map((code, i) => (
            <AnimatedBeam
              key={`d-${code}`}
              containerRef={containerRef}
              fromRef={hubRef}
              toRef={destinationRefs.current[i]}
              curvature={(i - (DESTINATIONS.length - 1) / 2) * 20}
              duration={4 + i * 0.4}
              delay={0.6 + i * 0.25}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
