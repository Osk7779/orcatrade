// Locale-aware href mapping. Mirrors js/site-nav.js so the marketing-shell
// header's EN/PL/DE switcher lands on the right slug for the user's
// current page, not just the locale homepage.

export type Locale = 'EN' | 'PL' | 'DE';

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

// Strip /pl/ or /de/ prefix to recover the EN-canonical href.
export function toEnCanonical(path: string): string {
  if (path.startsWith('/pl/')) return path.slice(3) || '/';
  if (path.startsWith('/de/')) return path.slice(3) || '/';
  return path || '/';
}

export function localizeHref(enHref: string, locale: Locale): string {
  if (locale === 'EN') return enHref;
  if (!enHref || !enHref.startsWith('/')) return enHref;
  if (isAppRoute(enHref)) return enHref;
  if (enHref === '/') return '/' + locale.toLowerCase() + '/';
  if (EN_ONLY.has(enHref)) return enHref; // graceful: keep EN
  const overrides = SLUG_OVERRIDES[locale];
  if (overrides[enHref]) return overrides[enHref];
  return '/' + locale.toLowerCase() + enHref;
}

// For the header lang switcher: given the user's current path, return
// the equivalent href in the target locale (route-aware).
export function switchLocale(currentPath: string, target: Locale): string {
  const enCanonical = toEnCanonical(currentPath);
  return localizeHref(enCanonical, target);
}
