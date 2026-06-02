'use client';

import { forwardRef, useRef } from 'react';
import { AnimatedBeam } from './animated-beam';
import { FadeUp } from './fade-up';
import { cn } from '@/lib/utils';

const ORIGINS = ['CN', 'VN', 'IN', 'BD', 'TR'];
const DESTINATIONS = ['DE', 'FR', 'NL', 'PL', 'ES', 'IT'];

const Node = forwardRef<
  HTMLDivElement,
  { children: React.ReactNode; className?: string; primary?: boolean }
>(({ children, className, primary }, ref) => (
  <div
    ref={ref}
    className={cn(
      'z-10 grid place-items-center border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)] text-[10px] font-medium tracking-tight text-[var(--color-ivory)] shadow-[0_4px_24px_rgba(0,0,0,0.45)] sm:text-[11px]',
      primary
        ? 'size-12 bg-[var(--color-ivory)] font-serif text-[var(--color-ink)] sm:size-16 sm:text-base'
        : 'size-9 sm:size-11',
      className,
    )}
    style={primary ? { fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 700 } : undefined}
  >
    {children}
  </div>
));
Node.displayName = 'Node';

export function StoryBeam() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const originRefs = useRef(ORIGINS.map(() => ({ current: null as HTMLDivElement | null })));
  const destinationRefs = useRef(DESTINATIONS.map(() => ({ current: null as HTMLDivElement | null })));

  return (
    <section
      id="platform"
      className="relative border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1280px] px-6">
        <FadeUp className="mx-auto max-w-[760px] text-center">
          <h2
            className="font-serif text-[clamp(2.2rem,3.8vw+0.4rem,3.4rem)] leading-[1.08] tracking-[-0.022em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
          >
            One platform between six origins
            <br className="hidden md:block" /> and your European market.
          </h2>
          <p className="mx-auto mt-6 max-w-[58ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
            Every lane is priced end-to-end — HS classification, duty,
            anti-dumping, CBAM, REACH, freight, last mile, FX and working
            capital — surfaced from one calculator-grounded engine.
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
