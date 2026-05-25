import Link from 'next/link';

// Links marked `inApp` are (or will be) Next routes inside the shell; the rest
// point at the existing account pages on the main site until they're ported.
const NAV: Array<{ label: string; href: string; inApp?: boolean }> = [
  { label: 'Dashboard', href: '/dashboard', inApp: true },
  { label: 'Plans', href: '/account/plans/' },
  { label: 'Portfolios', href: '/account/portfolios/' },
  { label: 'Monitoring alerts', href: '/account/alerts/' },
  { label: 'Compliance calendar', href: '/account/calendar/' },
  { label: 'Documents', href: '/account/documents/' },
  { label: 'Screening', href: '/account/screen/' },
  { label: 'Preferences', href: '/account/preferences/' },
];

export function Sidebar() {
  return (
    <aside className="w-60 shrink-0 border-r border-[var(--color-line)] p-6 min-h-screen">
      <Link href="/dashboard" className="block mb-8">
        <span className="font-serif text-2xl font-semibold text-ivory">OrcaTrade</span>
        <span className="block text-[0.62rem] tracking-[0.28em] uppercase text-[var(--color-gold-soft)] mt-1">
          Operations
        </span>
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) =>
          item.inApp ? (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-2 text-sm rounded-sm text-white/75 hover:text-white hover:bg-white/5 transition-colors"
            >
              {item.label}
            </Link>
          ) : (
            <a
              key={item.href}
              href={item.href}
              className="px-3 py-2 text-sm rounded-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
              {item.label}
            </a>
          ),
        )}
      </nav>
    </aside>
  );
}
