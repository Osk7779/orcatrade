'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// Sidebar organised in editorial sections. Section labels are small caps
// in IBM Plex Mono — same treatment as the marketing-shell's Tools mega-
// menu. Active link gets an ivory left-rail accent + ivory text, hover
// uses the navy-soft surface.

type NavItem = { label: string; href: string; inApp?: boolean };

const SECTIONS: { heading: string; items: NavItem[] }[] = [
  {
    // Imports — L1.0 of the strategic plan. The customer-intent
    // primitive that drives the Operator wedge (managed-import-as-a-
    // service take-rate). Sits above Workspace because it's the
    // front door of the new product surface: customers come here
    // first, the rest of the sidebar carries the system-of-record.
    heading: 'Imports',
    items: [
      { label: 'New request', href: '/imports/new', inApp: true },
      { label: 'My requests', href: '/imports', inApp: true },
      { label: 'Review queue', href: '/imports/queue', inApp: true },
    ],
  },
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

export function Sidebar() {
  const pathname = usePathname() || '';
  const [openAlerts, setOpenAlerts] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/alerts', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && typeof d.openCount === 'number') setOpenAlerts(d.openCount); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-white/[0.06] min-h-screen sticky top-0 max-h-screen overflow-y-auto">
      {/* Brand wordmark */}
      <Link
        href="/dashboard"
        className="block px-6 py-6 border-b border-white/[0.06] group"
      >
        <div className="flex items-baseline gap-2">
          <span className="text-[1.45rem] font-bold tracking-[-0.025em] text-[var(--color-ivory)] leading-none">
            OrcaTrade
          </span>
        </div>
        <span className="block mt-1.5 text-[12px] text-[var(--color-aqua)] tracking-[0.01em]">
          Operations
        </span>
      </Link>

      <nav className="flex-1 flex flex-col gap-6 px-3 py-6">
        {SECTIONS.map((section) => (
          <div key={section.heading} className="flex flex-col gap-0.5">
            <div className="px-3 mb-1.5">
              <span className="text-[10.5px] font-semibold tracking-[0.1em] uppercase text-[var(--color-ivory-mute)]/80">
                {section.heading}
              </span>
            </div>
            {section.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              const isAlerts = item.href === '/alerts';
              const badge = isAlerts && openAlerts && openAlerts > 0 ? (
                <span
                  className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 bg-[var(--color-critical)]/15 text-[var(--color-critical)] border border-[var(--color-critical)]/35"
                  style={{ borderRadius: '999px' }}
                  title={`${openAlerts} open monitoring alert${openAlerts === 1 ? '' : 's'}`}
                >
                  {openAlerts > 99 ? '99+' : openAlerts}
                </span>
              ) : null;

              const baseCls =
                'group/item relative flex items-center gap-2 px-3 py-2 text-[13.5px] transition-all duration-200';
              const stateCls = isActive
                ? 'text-[var(--color-ivory)] bg-[var(--color-aqua-soft)] font-medium'
                : 'text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] hover:bg-white/[0.025]';

              const inner = (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[2px] bg-[var(--color-aqua)]"
                      style={{ borderRadius: '2px' }}
                    />
                  )}
                  <span className="truncate">{item.label}</span>
                  {badge}
                </>
              );

              return item.inApp ? (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${baseCls} ${stateCls}`}
                  style={{ borderRadius: '8px' }}
                >
                  {inner}
                </Link>
              ) : (
                <a
                  key={item.href}
                  href={item.href}
                  className={`${baseCls} ${stateCls}`}
                  style={{ borderRadius: '8px' }}
                >
                  {inner}
                </a>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer colophon */}
      <div className="px-6 py-5 border-t border-white/[0.06] space-y-2">
        <a
          href="/account/"
          className="text-[12px] text-[var(--color-ivory-mute)] hover:text-[var(--color-aqua)] transition-colors"
        >
          Sign out ↗
        </a>
        <div className="font-serif italic text-[11.5px] text-[var(--color-ivory-mute)]/60">
          OrcaTrade Group · MMXXVI
        </div>
      </div>
    </aside>
  );
}
