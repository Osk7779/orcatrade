import Link from 'next/link';
import { CookiePreferencesLink } from './cookie-preferences-link';

const COLUMNS = [
  {
    title: 'Platform',
    links: [
      { href: '/start', label: 'Import plan builder' },
      { href: '/search', label: 'Search' },
      { href: '/sourcing', label: 'Sourcing' },
      { href: '/intelligence', label: 'Intelligence' },
      { href: '/logistics', label: 'Logistics' },
      { href: '/finance', label: 'Finance' },
      { href: '/process', label: 'The process' },
      { href: '/tools/quote-rebrand/', label: 'Quote Studio' },
      { href: '/app/dashboard', label: 'Cockpit' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { href: '/guides/customs', label: 'EU customs' },
      { href: '/guides/compliance', label: 'Compliance' },
      { href: '/guides/sourcing', label: 'Sourcing' },
      { href: '/guides/routing', label: 'Routing' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/#leadership', label: 'Leadership' },
      { href: '/contact', label: 'Contact' },
      { href: '/changelog', label: 'Changelog' },
      { href: '/regulations/privacy', label: 'Privacy' },
    ],
  },
];

const CITIES = ['London', 'Warsaw', 'Hong Kong'];

export function Footer() {
  return (
    <footer className="border-t border-[var(--color-navy-line)] bg-[var(--color-ink)]">
      <div className="mx-auto max-w-[1320px] px-7 py-20 md:px-9">
        {/* Top — wordmark + cities (scale of the firm) */}
        <div className="grid grid-cols-1 gap-12 border-b border-[var(--color-navy-line)] pb-14 md:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-5">
            <span className="flex items-baseline gap-2.5 font-serif leading-none text-[var(--color-ivory)]">
              <span
                className="text-[2rem] tracking-[-0.022em]"
                style={{
                  fontVariationSettings: "'SOFT' 28, 'opsz' 144",
                  fontWeight: 600,
                }}
              >
                OrcaTrade
              </span>
              <span className="text-[1.25rem] italic text-[var(--color-ivory-mute)]">
                Group
              </span>
            </span>
            <p className="max-w-[40ch] font-serif text-[1.05rem] italic leading-[1.55] text-[var(--color-ivory-dim)]">
              Calculator-grounded import operations for European businesses
              sourcing from Asia.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
              Offices
            </span>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] text-[var(--color-ivory-dim)]">
              {CITIES.map((city, i) => (
                <span key={city} className="flex items-center gap-4">
                  <span className="font-medium tracking-tight">{city}</span>
                  {i < CITIES.length - 1 && (
                    <span aria-hidden className="text-[var(--color-navy-line)]">
                      ·
                    </span>
                  )}
                </span>
              ))}
            </div>
            <span className="mt-1 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
              Established MMXXVI · Operating across the EU and the UK
            </span>
          </div>
        </div>

        {/* Middle — link columns */}
        <div className="grid grid-cols-1 gap-10 py-14 sm:grid-cols-2 md:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="mb-5 font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
                {col.title}
              </div>
              <ul className="space-y-3.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-[14px] text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom — legal line */}
        <div className="flex flex-col items-start justify-between gap-4 border-t border-[var(--color-navy-line)] pt-8 text-[12.5px] text-[var(--color-ivory-mute)] md:flex-row md:items-center">
          <span>
            © {new Date().getFullYear()} OrcaTrade Group Ltd. All rights reserved.
          </span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <CookiePreferencesLink />
            <span aria-hidden className="hidden text-[var(--color-navy-line)] md:inline">
              ·
            </span>
            <span className="font-serif italic">One platform · Asia → Europe</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
