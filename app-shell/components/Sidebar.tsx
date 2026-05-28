'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  inApp?: boolean;
}
interface NavGroup {
  kicker: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    kicker: 'Operations',
    items: [
      { label: 'Dashboard', href: '/dashboard', inApp: true },
      { label: 'Operations', href: '/operations', inApp: true },
      { label: 'Ask the agent', href: '/chat', inApp: true },
    ],
  },
  {
    kicker: 'Intelligence',
    items: [
      { label: 'Plans', href: '/plans', inApp: true },
      { label: 'Portfolios', href: '/portfolios', inApp: true },
      { label: 'Monitoring alerts', href: '/alerts', inApp: true },
      { label: 'Compliance calendar', href: '/calendar', inApp: true },
    ],
  },
  {
    kicker: 'Documents',
    items: [
      { label: 'Documents', href: '/documents', inApp: true },
      { label: 'Drafts', href: '/drafts', inApp: true },
      { label: 'Screening', href: '/screening', inApp: true },
    ],
  },
  {
    kicker: 'Account',
    items: [
      { label: 'Team', href: '/team', inApp: true },
      { label: 'Preferences', href: '/preferences', inApp: true },
    ],
  },
];

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const [openAlerts, setOpenAlerts] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/alerts', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.openCount === 'number') setOpenAlerts(d.openCount);
      })
      .catch(() => {
        /* silent on auth/network errors */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {/* Mobile hamburger — fixed top-left */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="fixed left-3 top-3 z-50 grid size-10 place-items-center border border-[var(--color-navy-line)] bg-[var(--color-ink)]/85 backdrop-blur-xl md:hidden"
      >
        <svg viewBox="0 0 16 16" className="size-4 text-[var(--color-ivory)]" aria-hidden>
          <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.2" />
          <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.2" />
          <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>

      {/* Backdrop (mobile only) */}
      {open && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-[var(--color-ink)]/85 backdrop-blur-xl md:hidden"
        />
      )}

      {/* Sidebar — fixed on desktop, drawer on mobile */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen w-[280px] flex-col border-r border-[var(--color-navy-line)] bg-[var(--color-ink)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        )}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-navy-line)] px-6 py-5">
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="flex items-baseline gap-2 font-serif text-[var(--color-ivory)]"
          >
            <span
              className="text-[1.35rem] tracking-[-0.022em]"
              style={{ fontVariationSettings: "'SOFT' 28, 'opsz' 144", fontWeight: 600 }}
            >
              OrcaTrade
            </span>
            <span className="text-[0.95rem] italic text-[var(--color-ivory-mute)]">Group</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="grid size-7 place-items-center text-[var(--color-ivory-mute)] transition-colors duration-300 hover:text-[var(--color-ivory)] md:hidden"
          >
            <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
              <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" />
              <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-8 overflow-y-auto px-4 py-6">
          {GROUPS.map((group) => (
            <div key={group.kicker} className="flex flex-col gap-1">
              <div className="mb-2 flex items-center gap-2 px-3">
                <span
                  aria-hidden
                  className="font-serif text-[12px] text-[var(--color-ivory-dim)]/55"
                >
                  ❦
                </span>
                <span className="font-serif text-[11.5px] italic text-[var(--color-ivory-mute)]">
                  {group.kicker}
                </span>
              </div>
              {group.items.map((item) => {
                const isAlerts = item.href === '/alerts';
                const badge =
                  isAlerts && openAlerts && openAlerts > 0 ? (
                    <span
                      className="ml-auto inline-flex min-w-[20px] items-center justify-center bg-[var(--color-critical)]/15 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-[var(--color-critical)]"
                      title={`${openAlerts} open monitoring alert${openAlerts === 1 ? '' : 's'}`}
                    >
                      {openAlerts > 99 ? '99+' : openAlerts}
                    </span>
                  ) : null;

                const className =
                  'group relative flex items-center gap-2 px-3 py-2 text-[13.5px] font-medium text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]';

                return item.inApp ? (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={className}
                  >
                    <span className="truncate">{item.label}</span>
                    {badge}
                  </Link>
                ) : (
                  <a key={item.href} href={item.href} className={className}>
                    <span className="truncate">{item.label}</span>
                    {badge}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--color-navy-line)] px-6 py-4">
          <a
            href="/"
            className="inline-flex items-center gap-2 font-serif text-[12.5px] italic text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
          >
            <span aria-hidden>↗</span>
            Back to orcatrade.pl
          </a>
        </div>
      </aside>
    </>
  );
}
