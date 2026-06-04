'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

// AccountWidget — mirrors the upgrade pattern from js/site-nav.js.
//
// SSR-default renders the "Sign in →" link (so unauthenticated visitors see
// the right CTA with no auth round-trip). On mount we read a sessionStorage
// hint to render the signed-in dropdown synchronously for return visitors
// (eliminates the flash of "Sign in" → email avatar), then fire
// /api/auth/me to confirm. The cookie remains the source of truth; the
// hint is a UI cache only.

type User = { email: string };

const HINT_KEY = 'orcatrade.session.hint.v1';
const HINT_TTL_MS = 24 * 60 * 60 * 1000;

function readHint(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { email?: string; savedAt?: number };
    if (!parsed || typeof parsed.email !== 'string') return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > HINT_TTL_MS) {
      window.localStorage.removeItem(HINT_KEY);
      return null;
    }
    return { email: parsed.email };
  } catch {
    return null;
  }
}

function writeHint(user: User) {
  try {
    window.localStorage.setItem(HINT_KEY, JSON.stringify({ email: user.email, savedAt: Date.now() }));
  } catch {
    /* private mode — ignore */
  }
}

function clearHint() {
  try { window.localStorage.removeItem(HINT_KEY); } catch { /* */ }
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 14) return local + domain;
  return local.slice(0, 12) + '…' + domain;
}

export function AccountWidget() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Render hint synchronously on mount, then confirm with /api/auth/me.
  useEffect(() => {
    setHydrated(true);
    const hint = readHint();
    if (hint) setUser(hint);

    fetch('/api/auth/me', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(async (r) => {
        if (r.status === 401) return { signedOut: true };
        if (!r.ok) return null;
        return r.json().catch(() => null);
      })
      .then((data) => {
        if (data && (data as { signedOut?: boolean }).signedOut) {
          clearHint();
          setUser(null);
          return;
        }
        const payload = data as { user?: User } | null;
        if (payload && payload.user && payload.user.email) {
          writeHint(payload.user);
          setUser(payload.user);
        }
      })
      .catch(() => { /* network blip — preserve hint state */ });
  }, []);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    clearHint();
    setUser(null);
    setOpen(false);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch { /* still locally signed out */ }
    // Stay on public pages, bounce off auth-gated ones.
    const path = window.location.pathname || '/';
    const gated = ['/account/', '/app/', '/dashboard/', '/tools/'].some((p) => path.startsWith(p));
    if (gated) window.location.href = '/';
  }

  // SSR + initial paint: render the "Sign in" link. Once hydrated and we
  // know the user is signed in, swap to the dropdown.
  if (!hydrated || !user) {
    return (
      <Link
        href="/signin"
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
    );
  }

  const label = maskEmail(user.email);
  const initial = (user.email[0] || '?').toUpperCase();

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="group flex items-center gap-2 border border-[var(--color-navy-line)] px-3 py-2 text-[13px] text-[var(--color-ivory)] hover:border-[var(--color-ivory-dim)]/45 hover:bg-[var(--color-navy-soft)]/60 transition-colors duration-300"
      >
        <span
          aria-hidden
          className="grid size-6 place-items-center border border-[var(--color-ivory-dim)]/35 bg-[var(--color-navy-soft)] font-mono text-[10.5px] font-medium text-[var(--color-ivory)]"
        >
          {initial}
        </span>
        <span className="font-medium truncate max-w-[180px]">{label}</span>
        <span
          aria-hidden
          className={`text-[10px] text-[var(--color-ivory-mute)] transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-[280px] border border-[var(--color-navy-line)] bg-[var(--color-ink)]/96 backdrop-blur-xl shadow-[0_24px_60px_-30px_rgba(0,0,0,0.7)]"
        >
          <div
            className="px-4 py-3 border-b border-[var(--color-navy-line)] font-mono text-[12px] text-[var(--color-ivory-dim)] truncate"
            title={user.email}
          >
            {user.email}
          </div>
          <nav className="flex flex-col py-1">
            <Link
              role="menuitem"
              href="/app/dashboard"
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 text-[13.5px] text-[var(--color-ivory)] hover:bg-[var(--color-navy-soft)]/60 transition-colors"
            >
              <span className="font-serif">Dashboard</span>
              <span className="block font-serif italic text-[12px] text-[var(--color-ivory-mute)] mt-0.5">
                Your cockpit
              </span>
            </Link>
            <Link
              role="menuitem"
              href="/app/plans"
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 text-[13.5px] text-[var(--color-ivory)] hover:bg-[var(--color-navy-soft)]/60 transition-colors"
            >
              <span className="font-serif">Saved plans</span>
            </Link>
            <Link
              role="menuitem"
              href="/app/portfolios"
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 text-[13.5px] text-[var(--color-ivory)] hover:bg-[var(--color-navy-soft)]/60 transition-colors"
            >
              <span className="font-serif">Portfolios</span>
            </Link>
            <Link
              role="menuitem"
              href="/app/preferences"
              onClick={() => setOpen(false)}
              className="px-4 py-2.5 text-[13.5px] text-[var(--color-ivory)] hover:bg-[var(--color-navy-soft)]/60 transition-colors"
            >
              <span className="font-serif">Settings</span>
            </Link>
          </nav>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="w-full text-left px-4 py-3 border-t border-[var(--color-navy-line)] font-mono text-[11px] tracking-[0.14em] uppercase text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)] hover:bg-[var(--color-navy-soft)]/60 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
