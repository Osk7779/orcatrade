'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

// Title-plate intro. Cinematic, editorial.
// Composition (top → bottom):
//   1. Tiny kicker — "Est. London · Warsaw · Hong Kong" in mono caps
//   2. Hairline ────── ❦ ──────
//   3. ORCATRADE GROUP, Fraunces 144, with letter-spacing ease-in
//   4. Italic-serif lede — "Asia to Europe — on one operating layer."
//   5. (P0.12 a11y) Visible "Press any key to continue" hint
//
// Each element reveals in sequence with a staggered ease-out. The whole
// plate fades after a hold, and a sessionStorage flag means it only
// plays once per browser session (subsequent loads skip it entirely so
// the user isn't waiting on a 2-second curtain on every page).
//
// Dismisses early on the user's first scroll or first pointer-down.
//
// Accessibility (Phase 0 P0.12):
//   - prefers-reduced-motion: skipped entirely. Per WCAG 2.3.3, when the
//     user signals they want reduced motion the decorative intro is not
//     shown (it's a curtain over the real content; the real content is
//     what the user came for). The session flag is set so subsequent
//     reloads also skip — consistent with the played-already path.
//   - role="dialog" + aria-label so screen readers announce the overlay
//     instead of skipping it (the prior aria-hidden silently swallowed
//     the brand intro for SR users).
//   - aria-live="polite" on the kicker so the announcement happens once
//     the plate is rendered, not the moment the dialog opens.
//   - Visible "Press any key to continue" hint at the bottom, surfaced
//     after the wordmark settles. WCAG 2.2.1 (Timing Adjustable) — the
//     intro is dismissible at any time + the dismiss mechanism is now
//     visible, not just discoverable by accident.

const SESSION_KEY = 'orcatrade.intro.played.v2';
const HOLD_MS = 4000;
const FADE_MS = 600;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function IntroOverlay() {
  const [visible, setVisible] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    // Skip if we already played the intro this session.
    if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) {
      return;
    }
    // P0.12 a11y: skip entirely when the user has requested reduced motion.
    // Set the session flag so reloads also skip — matches the already-played
    // path for consistency.
    if (prefersReducedMotion()) {
      try {
        sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        /* private mode etc. */
      }
      return;
    }

    setVisible(true);
    // Kick the reveal one frame after mount so the entry transitions fire.
    const raf = requestAnimationFrame(() => setRevealed(true));

    const dismiss = () => {
      setVisible(false);
      try {
        sessionStorage.setItem(SESSION_KEY, '1');
      } catch {
        /* private mode etc. — fine, just won't gate */
      }
    };

    const autoDismiss = window.setTimeout(dismiss, HOLD_MS);

    // Any input from the user — scroll wheel, touch swipe, mouse click,
    // key press — dismisses immediately. scroll alone can be too late on
    // mobile because the body may be locked behind the overlay.
    const onAny = () => dismiss();
    window.addEventListener('scroll', onAny, { once: true, passive: true });
    window.addEventListener('wheel', onAny, { once: true, passive: true });
    window.addEventListener('touchmove', onAny, { once: true, passive: true });
    window.addEventListener('touchstart', onAny, { once: true, passive: true });
    window.addEventListener('pointerdown', onAny, { once: true });
    window.addEventListener('keydown', onAny, { once: true });

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(autoDismiss);
      window.removeEventListener('scroll', onAny);
      window.removeEventListener('wheel', onAny);
      window.removeEventListener('touchmove', onAny);
      window.removeEventListener('touchstart', onAny);
      window.removeEventListener('pointerdown', onAny);
      window.removeEventListener('keydown', onAny);
    };
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="dialog"
          aria-label="OrcaTrade Group — site intro"
          aria-live="polite"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: FADE_MS / 1000, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--color-ink)]"
        >
          {/* Soft radial wash behind the plate — gives the navy depth */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 70% 50% at 50% 50%, rgba(250,250,247,0.04) 0%, transparent 60%)',
            }}
          />

          <div className="relative flex flex-col items-center px-8 text-center">
            {/* Kicker — locations in Plex Mono caps */}
            <motion.span
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: revealed ? 1 : 0, y: revealed ? 0 : 6 }}
              transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="font-mono text-[10.5px] uppercase tracking-[0.32em] text-[var(--color-ivory-mute)]"
            >
              London · Warsaw · Hong Kong
            </motion.span>

            {/* Hairline rule + fleuron centerpiece */}
            <div
              aria-hidden
              className="mt-7 flex items-center gap-5"
            >
              <motion.span
                initial={{ width: 0 }}
                animate={{ width: revealed ? 96 : 0 }}
                transition={{ duration: 0.9, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="block h-px"
                style={{
                  background:
                    'linear-gradient(to right, transparent, var(--color-ivory-dim), transparent)',
                }}
              />
              <motion.span
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: revealed ? 0.7 : 0, scale: revealed ? 1 : 0.6 }}
                transition={{ duration: 0.7, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="font-serif text-[16px] text-[var(--color-ivory-dim)]"
              >
                ❦
              </motion.span>
              <motion.span
                initial={{ width: 0 }}
                animate={{ width: revealed ? 96 : 0 }}
                transition={{ duration: 0.9, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="block h-px"
                style={{
                  background:
                    'linear-gradient(to left, transparent, var(--color-ivory-dim), transparent)',
                }}
              />
            </div>

            {/* Wordmark — Fraunces with letter-spacing ease-in */}
            <motion.span
              initial={{ opacity: 0, letterSpacing: '0.18em' }}
              animate={{
                opacity: revealed ? 1 : 0,
                letterSpacing: revealed ? '0.34em' : '0.18em',
              }}
              transition={{ duration: 1.4, delay: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 block font-serif text-[clamp(1.8rem,5.2vw,4.6rem)] text-[var(--color-ivory)]"
              style={{
                fontVariationSettings: "'SOFT' 28, 'opsz' 144",
                fontWeight: 400,
                textIndent: '0.34em',
                lineHeight: 1,
              }}
            >
              ORCATRADE GROUP
            </motion.span>

            {/* Italic-serif lede under the wordmark */}
            <motion.span
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: revealed ? 1 : 0, y: revealed ? 0 : 6 }}
              transition={{ duration: 0.9, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="mt-7 font-serif text-[13.5px] italic text-[var(--color-ivory-mute)]"
              style={{ fontVariationSettings: "'SOFT' 50, 'opsz' 144" }}
            >
              Asia to Europe — on one operating layer.
            </motion.span>

            {/* P0.12 a11y — visible dismiss hint. Fades in after the lede so it
                doesn't compete with the brand reveal but is on-screen by the
                time most readers would otherwise reach for the keyboard. */}
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: revealed ? 0.5 : 0 }}
              transition={{ duration: 0.6, delay: 1.6, ease: [0.16, 1, 0.3, 1] }}
              className="mt-10 font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-ivory-mute)]"
            >
              Press any key, or scroll, to continue
            </motion.span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
