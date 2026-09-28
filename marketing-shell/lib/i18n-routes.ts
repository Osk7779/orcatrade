// Locale-aware href mapping. Mirrors js/site-nav.js so the marketing-shell
// header's EN/PL/DE switcher lands on the right slug for the user's
// current page, not just the locale homepage.
//
// Resolution order: (1) the generated hreflang map (translated guide
// slugs — scripts/generate-locale-alternates.js), (2) SLUG_OVERRIDES,
// (3) EN-only routes stay EN, (4) the locale homepage. We never guess a
// `/pl/<en-path>` URL: guessed paths were 404ing for every guide.

import ALTERNATES from './locale-alternates.json';

export type Locale = 'EN' | 'PL' | 'DE';

const ALT = ALTERNATES as Record<string, { pl?: string; de?: string }>;

// Reverse index: localized path → EN canonical path.
const TO_EN: Record<string, string> = {};
for (const [en, alt] of Object.entries(ALT)) {
  if (alt.pl) TO_EN[alt.pl] = en;
  if (alt.de) TO_EN[alt.de] = en;
}

const SLUG_OVERRIDES: Record<Exclude<Locale, 'EN'>, Record<string, string>> = {
  PL: {
    '/pricing/': '/pl/cennik/',
    '/logistics/': '/pl/logistyka/',
    '/platform/': '/pl/platforma/',
    '/analysis/': '/pl/analiza/',
    '/supply-chain/': '/pl/lancuch-dostaw/',
    '/founding/': '/pl/zalozyciele-10/',
    '/sourcing/': '/pl/sourcing.html',
    '/finance/': '/pl/finance.html',
    '/intelligence/': '/pl/intelligence.html',
  },
  DE: {
    '/pricing/': '/de/preise/',
    '/logistics/': '/de/logistik/',
    '/platform/': '/de/plattform/',
    '/analysis/': '/de/analyse/',
    '/supply-chain/': '/de/lieferkette/',
    '/founding/': '/de/gruender-10/',
    '/sourcing/': '/de/sourcing.html',
    '/finance/': '/de/finance.html',
    '/intelligence/': '/de/intelligence.html',
  },
};

// Routes that only exist in EN (no PL/DE static page). The lang switcher
// should keep these on EN — switching to PL/DE for these would land on
// the locale homepage as a graceful fallback rather than a 404.
const EN_ONLY = new Set<string>([
  '/changelog/',
  '/portfolio/',
  '/signin/',
  '/signup/',
  '/status/',
  '/trust/',
  '/trust/anchors/',
  '/contact/',
  '/process/',
  '/search/',
]);

// App routes that are locale-agnostic — same surface for all locales.
function isAppRoute(href: string): boolean {
  return (
    href.startsWith('/agent/') ||
    href.startsWith('/dashboard/') ||
    href.startsWith('/account/') ||
    href.startsWith('/api/') ||
    href.startsWith('/app/')
  );
}

export function detectLocale(path: string): Locale {
  if (path.startsWith('/pl/') || path === '/pl') return 'PL';
  if (path.startsWith('/de/') || path === '/de') return 'DE';
  return 'EN';
}

// Recover the EN-canonical href for a (possibly localized) path.
export function toEnCanonical(path: string): string {
  if (!path || path === '/pl' || path === '/de' || path === '/pl/' || path === '/de/') return '/';
  const slashed = withTrailingSlash(path);
  if (TO_EN[slashed]) return TO_EN[slashed];
  for (const [locale, overrides] of Object.entries(SLUG_OVERRIDES)) {
    void locale;
    for (const [en, localized] of Object.entries(overrides)) {
      if (localized === path || localized === slashed) return en;
    }
  }
  if (path.startsWith('/pl/') || path.startsWith('/de/')) return path.slice(3) || '/';
  return path;
}

// Normalize so /pricing and /pricing/ are treated identically — Next.js'
// usePathname() returns the no-trailing-slash form, while SLUG_OVERRIDES
// is keyed with trailing slashes for parity with js/site-nav.js.
function withTrailingSlash(href: string): string {
  if (!href || href.endsWith('/')) return href;
  return href + '/';
}

export function localizeHref(enHref: string, locale: Locale): string {
  if (locale === 'EN') return enHref;
  if (!enHref || !enHref.startsWith('/')) return enHref;
  if (isAppRoute(enHref)) return enHref;
  if (enHref === '/') return '/' + locale.toLowerCase() + '/';
  const enWithSlash = withTrailingSlash(enHref);
  const alt = ALT[enWithSlash]?.[locale === 'PL' ? 'pl' : 'de'];
  if (alt) return alt;
  const overrides = SLUG_OVERRIDES[locale];
  if (overrides[enWithSlash]) return overrides[enWithSlash];
  if (EN_ONLY.has(enWithSlash)) return enHref; // graceful: keep EN
  // No known translation: land on the locale homepage, never a guessed URL.
  return '/' + locale.toLowerCase() + '/';
}

// For the header lang switcher: given the user's current path, return
// the equivalent href in the target locale (route-aware).
export function switchLocale(currentPath: string, target: Locale): string {
  const enCanonical = toEnCanonical(currentPath);
  return localizeHref(enCanonical, target);
}
