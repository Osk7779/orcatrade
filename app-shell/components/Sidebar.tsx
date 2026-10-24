'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// Cockpit navigation: a sidebar on desktop, a top bar + full-height menu
// on mobile, both rendering the same sections. Every item is an in-app
// route (inApp: resolved under the /app basePath by next/link).

type NavItem = { label: string; href: string; inApp: true };

const SECTIONS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Workspace',
    items: [
      { label: 'Dashboard', href: '/dashboard', inApp: true },
      { label: 'Operations', href: '/operations', inApp: true },
      { label: 'Ask the agent', href: '/chat', inApp: true },
    ],
  },
  {
    heading: 'Trade',
    items: [
      { label: 'Plans', href: '/plans', inApp: true },
      { label: 'Goods', href: '/goods', inApp: true },
      { label: 'Suppliers', href: '/suppliers', inApp: true },
      { label: 'Shipments', href: '/shipments', inApp: true },
      { label: 'Portfolios', href: '/portfolios', inApp: true },
      { label: 'Documents', href: '/documents', inApp: true },
      { label: 'Drafts', href: '/drafts', inApp: true },
    ],
  },
  {
    heading: 'Watch',
    items: [
      { label: 'Monitoring alerts', href: '/alerts', inApp: true },
      { label: 'Compliance calendar', href: '/calendar', inApp: true },
      { label: 'Screening', href: '/screening', inApp: true },
    ],
  },
  {
    heading: 'Account',
    items: [
      { label: 'Team', href: '/team', inApp: true },
      { label: 'Preferences', href: '/preferences', inApp: true },
    ],
  },
];

function NavSections({ pathname, openAlerts, onNavigate }: { pathname: string; openAlerts: number | null; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-6 px-4 py-6">
      {SECTIONS.map((section) => (
        <div key={section.heading} className="flex flex-col gap-0.5">
          <div className="mb-1 px-3 text-[12px] text-[var(--color-ivory-mute)]">{section.heading}</div>
          {section.items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            const badge =
              item.href === '/alerts' && openAlerts && openAlerts > 0 ? (
                <span
                  className="ml-auto rounded-full bg-[var(--color-critical)] px-1.5 py-px text-[11px] font-semibold text-white"
                  title={`${openAlerts} open monitoring alert${openAlerts === 1 ? '' : 's'}`}
                >
                  {openAlerts > 99 ? '99+' : openAlerts}
                </span>
              ) : null;
            const cls = `flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] transition-colors duration-200 ${
              isActive
                ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                : 'text-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)] hover:text-[var(--color-ivory)]'
            }`;
            return (
              <Link key={item.href} href={item.href} className={cls} onClick={onNavigate}>
                <span className="truncate">{item.label}</span>
                {badge}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--color-navy-line)] px-7 py-5 text-[13px]">
      {/* Plain anchors: these live outside the /app basePath. */}
      <a href="/" className="text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)]">
        ← orcatrade.pl
      </a>
      <a href="/account/" className="text-[var(--color-link)] hover:underline">
        Account &amp; sign out
      </a>
    </div>
  );
}

function Wordmark() {
  return (
    <Link href="/dashboard" className="flex items-baseline gap-1.5 text-[17px] font-semibold tracking-[-0.02em] text-[var(--color-ivory)]">
      OrcaTrade
      <span className="font-normal text-[var(--color-ivory-mute)]">Operations</span>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname() || '';
  const [openAlerts, setOpenAlerts] = useState<number | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/alerts', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && typeof d.openCount === 'number') setOpenAlerts(d.openCount); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <>
      {/* Mobile: slim top bar + full-height menu (the sidebar is desktop-only). */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b border-[var(--color-navy-line)] bg-white/85 px-4 backdrop-blur-xl md:hidden">
        <Wordmark />
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          className="flex size-9 flex-col items-center justify-center gap-[6px]"
        >
          <span className={`block h-[1.5px] w-[18px] bg-[var(--color-ivory)] transition-transform ${mobileOpen ? 'translate-y-[3.75px] rotate-45' : ''}`} />
          <span className={`block h-[1.5px] w-[18px] bg-[var(--color-ivory)] transition-transform ${mobileOpen ? '-translate-y-[3.75px] -rotate-45' : ''}`} />
        </button>
      </div>
      <div className="h-12 w-full shrink-0 md:hidden" aria-hidden />
      {mobileOpen && (
        <div className="fixed inset-x-0 bottom-0 top-12 z-40 flex flex-col overflow-y-auto bg-white md:hidden">
          <NavSections pathname={pathname} openAlerts={openAlerts} onNavigate={() => setMobileOpen(false)} />
          <SidebarFooter />
        </div>
      )}

      <aside className="sticky top-0 hidden max-h-screen min-h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-[var(--color-navy-line)] bg-[var(--color-navy)] md:flex">
        <div className="border-b border-[var(--color-navy-line)] px-7 py-6">
          <Wordmark />
        </div>
        <NavSections pathname={pathname} openAlerts={openAlerts} />
        <SidebarFooter />
      </aside>
    </>
  );
}
