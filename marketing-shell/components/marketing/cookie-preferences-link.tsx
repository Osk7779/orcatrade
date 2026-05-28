'use client';

// Small footer link that re-opens the cookie banner. Dispatches a custom
// event the CookieBanner component listens for. Matches the existing
// static-site pattern (window.orcatradeConsent.open()) but uses an event
// instead of a global, so it stays React-idiomatic.
export function CookiePreferencesLink() {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new CustomEvent('orcatrade:open-cookie-banner'))
      }
      className="font-serif italic text-[var(--color-ivory-mute)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
    >
      Cookie preferences
    </button>
  );
}
