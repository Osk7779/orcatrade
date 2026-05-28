'use client';

import { useEffect, useRef, useState } from 'react';

// Ported behaviour from the existing static OrcaTrade.pl:
// - Full-screen dark overlay
// - Centered "ORCATRADE GROUP" wordmark fades in (1.2s)
// - Hairline gradient rule grows from 0 to 120px (0.9s, 0.6s delay)
// - Overlay fades out (0.9s) after 3.5s or on first scroll
// - Self-removes from the DOM after the fade
//
// Plays on every initial mount of the marketing surface.
export function IntroOverlay() {
  const [mounted, setMounted] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [fading, setFading] = useState(false);
  const dismissed = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setRevealed(true));

    const dismiss = () => {
      if (dismissed.current) return;
      dismissed.current = true;
      setFading(true);
      // Wait out the 900ms overlay fade before un-mounting.
      window.setTimeout(() => setMounted(false), 900);
    };

    const autoDismissTimer = window.setTimeout(dismiss, 3500);
    const onScroll = () => dismiss();
    window.addEventListener('scroll', onScroll, { once: true, passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(autoDismissTimer);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  if (!mounted) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--color-ink)] transition-opacity duration-[900ms] ease-out"
      style={{
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      <div className="select-none text-center">
        <span
          className="block font-serif text-[clamp(1.6rem,5vw,4.4rem)] text-[var(--color-ivory)] transition-opacity duration-[1200ms] ease-out"
          style={{
            opacity: revealed ? 1 : 0,
            letterSpacing: '0.42em',
            textIndent: '0.42em',
            fontVariationSettings: "'SOFT' 28, 'opsz' 144",
            fontWeight: 400,
          }}
        >
          ORCATRADE GROUP
        </span>
        <span
          aria-hidden
          className="mx-auto mt-6 block h-px transition-[width] delay-[600ms] duration-[900ms] ease-out"
          style={{
            width: revealed ? '120px' : '0px',
            background:
              'linear-gradient(to right, transparent, var(--color-ivory), transparent)',
          }}
        />
      </div>
    </div>
  );
}
