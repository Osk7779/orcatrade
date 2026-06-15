'use client';

// Imports — customer-side list of the signed-in user's own import
// requests. L1.0 of docs/strategic-plan-2026-2031.md §4.1.2 (the
// customer-intent primitive that drives the Operator wedge).
//
// Reads:
//   GET /api/imports?mine=1  → ImportRequest[]
//
// Shape mirrors the existing /shipments and /goods list pages: an
// editorial header, a status filter, and a table. A fetch failure
// shows a friendly inline error and preserves the rest of the page.

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  apiGet,
  AuthError,
  IMPORT_REQUEST_STATUSES,
  type ImportRequest,
  type ImportRequestStatus,
} from '@/lib/api';

type LoadState = 'loading' | 'auth' | 'error' | 'ready';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + Math.round(cents / 100).toLocaleString('en-IE');
}

function statusLabel(s: ImportRequestStatus) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function statusTone(s: ImportRequestStatus): string {
  if (s === 'failed' || s === 'cancelled' || s === 'customer_rejected') return 'var(--color-critical)';
  if (s === 'customer_approved') return 'var(--color-positive)';
  if (s === 'awaiting_review' || s === 'processing') return 'var(--color-warning)';
  if (s === 'quoted') return 'var(--color-ivory)';
  return 'var(--color-ivory-mute)';
}

function ageLabel(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  const mins = Math.floor(ms / 60_000);
  if (mins >= 1) return `${mins}m ago`;
  return 'just now';
}

export default function ImportsPage() {
  return (
    <Suspense fallback={<p className="text-white/50 text-sm">Loading imports…</p>}>
      <ImportsView />
    </Suspense>
  );
}

function ImportsView() {
  const router = useRouter();
  const sp = useSearchParams();
  const filterStatus = sp.get('status') as ImportRequestStatus | null;

  const [state, setState] = useState<LoadState>('loading');
  const [requests, setRequests] = useState<ImportRequest[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set('mine', '1');
    if (filterStatus) params.set('status', filterStatus);
    apiGet<{ ok: boolean; importRequests: ImportRequest[] }>(`/imports?${params.toString()}`)
      .then((d) => {
        if (cancelled) return;
        setRequests(Array.isArray(d.importRequests) ? d.importRequests : []);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) setState('auth');
        else {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load your import requests');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filterStatus]);

  const counts = useMemo(() => {
    const map: Partial<Record<ImportRequestStatus, number>> = {};
    for (const r of requests) map[r.status] = (map[r.status] || 0) + 1;
    return map;
  }, [requests]);

  if (state === 'auth') {
    return (
      <section className="space-y-4">
        <h1 className="font-serif text-3xl text-[var(--color-ivory)]">Imports</h1>
        <p className="text-[var(--color-ivory-mute)] text-sm">
          Please <a href="/account/" className="underline hover:text-[var(--color-ivory)]">sign in</a> to see your import requests.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-10">
      {/* Editorial header */}
      <header className="space-y-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">L1.0 · Operator wedge</span>
        </div>
        <h1 className="font-serif text-4xl text-[var(--color-ivory)] tracking-[-0.02em]">Your import requests</h1>
        <p className="text-[var(--color-ivory-mute)] text-[15px] max-w-2xl leading-relaxed">
          Tell us what you want from Asia. We build a factory shortlist and a fully landed-cost
          quote — duty, VAT, freight, finance, fees — one number, one accountable party.
        </p>
        <div className="pt-2">
          <Link
            href="/imports/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-ivory)] text-[var(--color-navy)] font-mono text-[12px] tracking-[0.12em] uppercase hover:bg-[var(--color-ivory-dim)] transition-colors"
          >
            New import request
            <span aria-hidden>→</span>
          </Link>
        </div>
      </header>

      {/* Status filter */}
      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        <FilterChip label="All" active={!filterStatus} count={requests.length} onClick={() => router.push('/imports')} />
        {IMPORT_REQUEST_STATUSES.map((s) => {
          const n = counts[s] || 0;
          if (n === 0 && filterStatus !== s) return null;
          return (
            <FilterChip
              key={s}
              label={statusLabel(s)}
              count={n}
              active={filterStatus === s}
              onClick={() => router.push(`/imports?status=${s}`)}
              tone={statusTone(s)}
            />
          );
        })}
      </nav>

      {/* Table or empty state */}
      {state === 'loading' && <p className="text-[var(--color-ivory-mute)] text-sm">Loading…</p>}
      {state === 'error' && (
        <div className="border border-[var(--color-critical)]/35 bg-[var(--color-critical)]/10 p-4">
          <p className="font-mono text-[12px] tracking-[0.1em] uppercase text-[var(--color-critical)]">Could not load requests</p>
          <p className="text-[var(--color-ivory-mute)] text-sm mt-1">{errorMsg}</p>
        </div>
      )}
      {state === 'ready' && requests.length === 0 && (
        <div className="border border-[var(--color-navy-line)] p-10 text-center">
          <p className="font-serif italic text-[var(--color-ivory-mute)] text-lg">No import requests yet.</p>
          <p className="text-[var(--color-ivory-mute)] text-sm mt-2">
            Start with <Link className="underline hover:text-[var(--color-ivory)]" href="/imports/new">a new request</Link> — we will surface a shortlist + landed-cost quote within a few minutes.
          </p>
        </div>
      )}
      {state === 'ready' && requests.length > 0 && (
        <div className="border border-[var(--color-navy-line)] overflow-hidden">
          <table className="w-full text-left text-[13.5px]">
            <thead className="bg-[var(--color-navy-soft)]/40 text-[var(--color-ivory-mute)]">
              <tr>
                <Th>Label</Th>
                <Th>Product</Th>
                <Th>Route</Th>
                <Th>Status</Th>
                <Th align="right">Landed total</Th>
                <Th align="right">Updated</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr
                  key={r.externalId}
                  className="border-t border-[var(--color-navy-line)] hover:bg-[var(--color-navy-soft)]/30 transition-colors"
                >
                  <Td>
                    <Link
                      href={`/imports/${r.externalId}`}
                      className="text-[var(--color-ivory)] hover:underline"
                    >
                      {r.label}
                    </Link>
                    <div className="font-mono text-[10px] tracking-[0.1em] uppercase text-[var(--color-ivory-mute)]/70 mt-1">
                      {r.externalId}
                    </div>
                  </Td>
                  <Td>
                    <span className="text-[var(--color-ivory-dim)] line-clamp-2">{r.productDescription}</span>
                  </Td>
                  <Td>
                    <span className="font-mono text-[12px] text-[var(--color-ivory-dim)]">
                      {(r.originCountry || '?')} → {r.destinationCountry}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.1em] uppercase"
                      style={{ color: statusTone(r.status) }}
                    >
                      <span
                        aria-hidden
                        className="inline-block w-1.5 h-1.5"
                        style={{ background: statusTone(r.status) }}
                      />
                      {statusLabel(r.status)}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="font-mono text-[13px] text-[var(--color-ivory)]">
                      {eurFromCents(r.landedQuote?.totalLandedCents ?? null)}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="font-mono text-[11px] tracking-[0.05em] text-[var(--color-ivory-mute)]">
                      {ageLabel(r.updatedAt)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note — explicit about the v1 state */}
      <footer className="border-t border-[var(--color-navy-line)] pt-6 text-[var(--color-ivory-mute)] text-[12px] font-serif italic max-w-2xl leading-relaxed">
        v1 of the Operator wedge ships the customer-intent + AI-shortlist + calculator-grounded
        quote flow. Fulfilment (factory comms, customs filing, freight booking, finance) is run
        by the OrcaTrade team behind the curtain until partner integrations land in sprint 2.
      </footer>
    </section>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] uppercase border transition-colors ${
        active
          ? 'border-[var(--color-ivory)] text-[var(--color-ivory)] bg-[var(--color-navy-soft)]/60'
          : 'border-[var(--color-navy-line)] text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)] hover:border-[var(--color-ivory-mute)]'
      }`}
    >
      {tone && (
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 mr-2 align-middle"
          style={{ background: tone }}
        />
      )}
      {label}
      <span className="ml-2 text-[var(--color-ivory-mute)]/80">{count}</span>
    </button>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return (
    <th
      className={`px-4 py-3 font-mono text-[10px] tracking-[0.14em] uppercase ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return (
    <td className={`px-4 py-3 align-top ${align === 'right' ? 'text-right' : ''}`}>{children}</td>
  );
}
