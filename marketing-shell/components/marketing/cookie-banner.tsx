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
  const [customising, setCustomising] = useState(false);

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
      setCustomising(true);
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
      className="fixed inset-x-3 bottom-3 z-[80] mx-auto max-w-[680px] rounded-2xl border border-[var(--color-navy-line)] bg-white/95 p-5 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.18)] backdrop-blur-xl md:bottom-5 md:p-6"
    >
      <p className="text-[13.5px] leading-[1.5] text-[var(--color-ivory-dim)]">
        We use essential cookies for sign-in and preferences. With your consent we also count anonymous
        page views with Vercel Analytics — no behavioural tracking.{' '}
        <a href="/regulations/privacy/" className="text-[var(--color-link)] hover:underline">
          Privacy policy
        </a>
      </p>

      {customising && (
        <div className="mt-4 grid gap-3 border-t border-[var(--color-navy-line)] pt-4">
          <CategoryRow
            title="Essential"
            description="Sign-in, sessions and cache preferences. Always on."
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
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {customising ? (
          <button
            type="button"
            onClick={() => decide(analyticsOn)}
            className="btn-secondary !px-4 !py-1.5 !text-[13px]"
          >
            Save choices
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCustomising(true)}
            className="mr-auto text-[13px] text-[var(--color-link)] hover:underline"
          >
            Customise
          </button>
        )}
        <button
          type="button"
          onClick={() => decide(false)}
          className="btn-secondary !px-4 !py-1.5 !text-[13px]"
        >
          Reject optional
        </button>
        <button type="button" onClick={() => decide(true)} className="btn-primary !px-4 !py-1.5 !text-[13px]">
          Accept all
        </button>
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
    <label className={`flex items-center justify-between gap-6 ${locked ? 'cursor-default' : 'cursor-pointer'}`}>
      <span>
        <span className="block text-[13.5px] font-semibold text-[var(--color-ivory)]">{title}</span>
        <span className="block text-[12.5px] text-[var(--color-ivory-mute)]">{description}</span>
      </span>
      <span
        className={`relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors duration-200 ${
          checked ? 'bg-[#34c759]' : 'bg-[#e9e9eb]'
        } ${locked ? 'opacity-60' : ''}`}
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
          className={`absolute top-[2px] size-[22px] rounded-full bg-white shadow transition-all duration-200 ${
            checked ? 'left-[20px]' : 'left-[2px]'
          }`}
        />
      </span>
    </label>
  );
}
