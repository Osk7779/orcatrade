import Link from 'next/link';
import { ScrollProgress } from './scroll-progress';
import { TimezoneClocks } from './timezone-clocks';
import { MobileMenu } from './mobile-menu';

// Two tiers — but the top tier earns its place by carrying live trading
// clocks, not chrome. Tier 2 is the main masthead: wordmark, nav, CTAs.
const NAV = [
  { href: '/#platform', label: 'Platform' },
  { href: '/tools/quote-rebrand/', label: 'Tools' },
  { href: '/#examples', label: 'Examples' },
  { href: '/#leadership', label: 'Team' },
  { href: '/#news', label: 'News' },
];

const LOCALES = [
  { label: 'EN', active: true },
  { label: 'PL', active: false },
  { label: 'DE', active: false },
];

export function Header() {
  return (
    <header className="sticky top-0 z-50 bg-[var(--color-ink)]/88 backdrop-blur-xl">
      <ScrollProgress />

      {/* TIER 1 — live clocks left, locale right. Hairline below. */}
      <div className="border-b border-[var(--color-navy-line)]/70">
        <div className="mx-auto flex h-10 max-w-[1320px] items-center justify-between gap-4 px-6 md:gap-6 md:px-9">
          <TimezoneClocks />
          <div className="hidden items-center gap-2 text-[12px] md:flex">
            {LOCALES.map((l, i) => (
              <span key={l.label} className="flex items-center gap-2">
                <span
                  className={
                    l.active
                      ? 'font-semibold text-[var(--color-ivory)]'
                      : 'cursor-not-allowed font-medium text-[var(--color-ivory-dim)] opacity-50'
                  }
                >
                  {l.label}
                </span>
                {i < LOCALES.length - 1 && (
                  <span aria-hidden className="text-[var(--color-navy-line)]">
                    /
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* TIER 2 — wordmark · nav · CTA cluster (desktop) | wordmark · hamburger (mobile) */}
      <div className="border-b border-[var(--color-navy-line)]">
        <div className="mx-auto flex h-[68px] max-w-[1320px] items-center justify-between gap-6 px-6 md:h-[72px] md:gap-12 md:px-9">
          <Link
            href="/"
            className="flex items-baseline gap-2 font-serif leading-none text-[var(--color-ivory)]"
          >
            <span
              className="text-[1.55rem] tracking-[-0.022em] md:text-[1.7rem]"
              style={{
                fontVariationSettings: "'SOFT' 28, 'opsz' 144",
                fontWeight: 600,
              }}
            >
              OrcaTrade
            </span>
            <span className="text-[1rem] italic text-[var(--color-ivory-mute)] md:text-[1.1rem]">
              Group
            </span>
          </Link>

          <MobileMenu />

          <nav className="hidden flex-1 items-center justify-center gap-9 md:flex lg:gap-11">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group relative py-1 text-[13.5px] font-medium text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
              >
                {item.label}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/75 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-5 md:flex">
            <span aria-hidden className="h-5 w-px bg-[var(--color-navy-line)]" />
            <Link
              href="/start"
              className="group inline-flex items-center gap-2 border border-[var(--color-ivory-dim)]/35 px-5 py-2.5 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
            >
              Import plan
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover:translate-x-0.5"
              >
                →
              </span>
            </Link>
            <Link
              href="/app/dashboard"
              className="group inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
            >
              Sign in
              <span
                aria-hidden
                className="text-[var(--color-ivory-mute)] transition-colors duration-300 group-hover:text-[var(--color-ivory)]"
              >
                ↗
              </span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
