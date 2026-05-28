'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

// Links marked `inApp` are (or will be) Next routes inside the shell; the rest
// point at the existing account pages on the main site until they're ported.
const NAV: Array<{ label: string; href: string; inApp?: boolean }> = [
  { label: 'Dashboard', href: '/dashboard', inApp: true },
  { label: 'Operations', href: '/operations', inApp: true },
  { label: 'Ask the agent', href: '/chat', inApp: true },
  { label: 'Plans', href: '/plans', inApp: true },
  { label: 'Portfolios', href: '/portfolios', inApp: true },
  { label: 'Monitoring alerts', href: '/alerts', inApp: true },
  { label: 'Compliance calendar', href: '/calendar', inApp: true },
  { label: 'Documents', href: '/documents', inApp: true },
  { label: 'Drafts', href: '/drafts', inApp: true },
  { label: 'Marketplace', href: '/marketplace', inApp: true },
  { label: 'Screening', href: '/screening', inApp: true },
  { label: 'Team', href: '/team', inApp: true },
  { label: 'Preferences', href: '/preferences', inApp: true },
];

export function Sidebar() {
  // Unread-alerts badge — single fetch on mount, silent on auth/network errors
  // so an unauthed visitor never sees a noisy badge. /api/account/alerts
  // returns { openCount } already (see lib/handlers/account.js handleAlerts).
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
    <aside className="w-60 shrink-0 border-r border-[var(--color-line)] p-6 min-h-screen">
      <Link href="/dashboard" className="block mb-8">
        <span className="font-serif text-2xl font-semibold text-ivory">OrcaTrade</span>
        <span className="block text-[0.62rem] tracking-[0.28em] uppercase text-[var(--color-accent-soft)] mt-1">
          Operations
        </span>
      </Link>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => {
          const isAlerts = item.href === '/alerts';
          const badge = isAlerts && openAlerts && openAlerts > 0
            ? (
              <span
                className="ml-auto font-mono text-[0.62rem] px-1.5 py-0.5 rounded-sm bg-red-500/20 text-red-200 border border-red-500/30"
                title={`${openAlerts} open monitoring alert${openAlerts === 1 ? '' : 's'}`}
              >
                {openAlerts > 99 ? '99+' : openAlerts}
              </span>
            )
            : null;
          return item.inApp ? (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-sm text-white/75 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span className="truncate">{item.label}</span>
              {badge}
            </Link>
          ) : (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span className="truncate">{item.label}</span>
              {badge}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
