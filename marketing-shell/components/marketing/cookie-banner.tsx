'use client';

import { useEffect, useState } from 'react';

// GDPR cookie consent banner. Ports the existing static-site behaviour
// (same storage key, same shape, both category rows always visible, three
// actions always available) into the new editorial aesthetic.

const STORAGE_KEY = 'orcatrade.consent.v1';

interface ConsentDecision {
  version: 1;
  decidedAt: string;
  categories: { essential: true; analytics: boolean };
}

function readDecision(): ConsentDecision | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentDecision;
    if (!parsed || parsed.version !== 1) return null;
    parsed.categories = { ...parsed.categories, essential: true };
    return parsed;
  } catch {
    return null;
  }
}

function writeDecision(analytics: boolean) {
  if (typeof window === 'undefined') return;
  const decision: ConsentDecision = {
    version: 1,
    decidedAt: new Date().toISOString(),
    categories: { essential: true, analytics },
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(decision));
  } catch {
    /* private mode / quota — banner shows again next visit */
  }
}

export function CookieBanner() {
  const [needed, setNeeded] = useState(false);
  const [analyticsOn, setAnalyticsOn] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const prior = readDecision();
      if (!prior) {
        setNeeded(true);
      } else {
        // Pre-seed the toggle with the prior choice so the banner can be
        // re-opened with the user's current state visible.
        setAnalyticsOn(prior.categories.analytics);
      }
    }, 400);

    const onOpen = () => {
      const prior = readDecision();
      setAnalyticsOn(prior?.categories.analytics ?? true);
      setNeeded(true);
    };
    window.addEventListener('orcatrade:open-cookie-banner', onOpen);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener('orcatrade:open-cookie-banner', onOpen);
    };
  }, []);

  if (!needed) return null;

  const decide = (analytics: boolean) => {
    writeDecision(analytics);
    setNeeded(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookies and analytics"
      className="fixed inset-x-3 bottom-3 z-[80] mx-auto md:bottom-5"
      style={{ maxWidth: '720px' }}
    >
      <div className="relative border border-[var(--color-navy-line)] bg-[var(--color-ink)]/96 p-6 shadow-[0_22px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:p-8">
        {/* Title row + close */}
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <span aria-hidden className="font-serif text-[15px] text-[var(--color-ivory-dim)]/65">
              ❦
            </span>
            <h3
              className="font-serif text-[1.2rem] italic leading-tight text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 500 }}
            >
              Cookies &amp; analytics
            </h3>
          </div>
          <button
            type="button"
            onClick={() => setNeeded(false)}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center text-[var(--color-ivory-mute)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
          >
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
              <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.25" />
              <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.25" />
            </svg>
          </button>
        </div>

        <p className="mt-4 max-w-[58ch] text-[13.5px] leading-[1.6] text-[var(--color-ivory-dim)]">
          OrcaTrade uses essential cookies for sign-in and to remember your
          preferences. With your consent, we also use Vercel Analytics to
          measure which pages people read &mdash; anonymous page-view counts
          only, no behavioural tracking.
        </p>

        {/* Categories — always visible, matches the original layout */}
        <div className="mt-6 grid gap-4 border-t border-[var(--color-navy-line)] pt-5 sm:gap-5">
          <CategoryRow
            title="Essential"
            description="Required for sign-in, sessions, and cache preferences."
            locked
            checked
          />
          <CategoryRow
            title="Analytics"
            description="Anonymous page-view counts via Vercel Analytics."
            checked={analyticsOn}
            onChange={setAnalyticsOn}
          />
        </div>

        {/* Three actions — Reject / Save / Accept. Accept is the primary
            (ivory fill); Save matches the user's current toggle state;
            Reject is the safe outline. */}
        <div className="mt-7 flex flex-wrap items-center justify-end gap-2.5 border-t border-[var(--color-navy-line)] pt-6">
          <button
            type="button"
            onClick={() => decide(false)}
            className="inline-flex items-center border border-[var(--color-navy-line)] px-5 py-2.5 text-[12px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
          >
            Reject optional
          </button>
          <button
            type="button"
            onClick={() => decide(analyticsOn)}
            className="inline-flex items-center border border-[var(--color-ivory-dim)]/60 px-5 py-2.5 text-[12px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory)] hover:bg-[var(--color-navy-soft)]"
          >
            Save my choice
          </button>
          <button
            type="button"
            onClick={() => decide(true)}
            className="group inline-flex items-center gap-2 bg-[var(--color-ivory)] px-5 py-2.5 text-[12px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
          >
            Accept all
            <span
              aria-hidden
              className="transition-transform duration-500 group-hover:translate-x-0.5"
            >
              →
            </span>
          </button>
        </div>

        <a
          href="/regulations/privacy.html"
          className="mt-5 inline-flex items-center gap-1.5 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
        >
          Read our privacy policy
          <span aria-hidden>→</span>
        </a>
      </div>
    </div>
  );
}

function CategoryRow({
  title,
  description,
  checked,
  locked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  locked?: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-6 ${
        locked ? 'cursor-default' : 'cursor-pointer'
      }`}
    >
      <span className="flex flex-col gap-1">
        <span className="flex items-baseline gap-2">
          <span
            className="font-serif text-[14.5px] italic text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 500 }}
          >
            {title}
          </span>
          {locked && (
            <span className="font-serif text-[11.5px] italic text-[var(--color-ivory-mute)]">
              · always on
            </span>
          )}
        </span>
        <span className="max-w-[44ch] text-[12.5px] leading-[1.55] text-[var(--color-ivory-dim)]">
          {description}
        </span>
      </span>
      <span
        className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center border transition-colors duration-300 ${
          checked
            ? 'border-[var(--color-ivory)]/60 bg-[var(--color-ivory)]/15'
            : 'border-[var(--color-navy-line)] bg-[var(--color-ink)]'
        } ${locked ? 'opacity-90' : ''}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={(e) => onChange?.(e.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden
          className={`absolute top-1/2 size-[14px] -translate-y-1/2 transition-all duration-300 ${
            checked
              ? 'left-[20px] bg-[var(--color-ivory)]'
              : 'left-[3px] bg-[var(--color-ivory-dim)]'
          }`}
        />
      </span>
    </label>
  );
}
