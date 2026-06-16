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
  type DeclineReason,
  DECLINE_REASONS,
  DECLINE_REASON_LABELS,
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
  // Sprint 23 — cohort drill-down from /imports/insights. When set,
  // the page renders the org-wide cohort (NOT scoped to mine=1) +
  // surfaces a cohort header. Validated against DECLINE_REASONS so
  // a forged URL falls back to null cleanly.
  const declineReasonRaw = sp.get('declineReason');
  const cohortReason: DeclineReason | null = (
    declineReasonRaw && (DECLINE_REASONS as ReadonlyArray<string>).includes(declineReasonRaw)
      ? (declineReasonRaw as DeclineReason)
      : null
  );

  const [state, setState] = useState<LoadState>('loading');
  const [requests, setRequests] = useState<ImportRequest[]>([]);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    // Cohort drill-down is an ops view of org-wide requests; the
    // customer view stays scoped to their own. Same RBAC at the
    // handler — only ops can hit the /insights surface that
    // links here.
    if (!cohortReason) params.set('mine', '1');
    if (filterStatus) params.set('status', filterStatus);
    if (cohortReason) params.set('declineReason', cohortReason);
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
  }, [filterStatus, cohortReason]);

  const counts = useMemo(() => {
    const map: Partial<Record<ImportRequestStatus, number>> = {};
    for (const r of requests) map[r.status] = (map[r.status] || 0) + 1;
    return map;
  }, [requests]);

  if (state === 'auth') {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-ivory)]">Imports</h1>
        <p className="text-[var(--color-ivory-mute)] text-sm">
          Please <a href="/account/" className="text-[var(--color-aqua)] hover:underline">sign in</a> to see your import requests.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-12 pb-16">
      {/* Hero — Inter-bold display with aqua accent, aligned to /imports/new */}
      <header className="relative pt-4">
        <div
          aria-hidden
          className="absolute -top-8 -right-8 w-64 h-64 pointer-events-none rounded-full"
          style={{
            background: 'radial-gradient(closest-side, var(--color-aqua-glow), transparent)',
            filter: 'blur(8px)',
          }}
        />
        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="space-y-4 max-w-2xl">
            <span className="inline-block text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
              L1.0 · Operator wedge
            </span>
            <h1 className="text-[clamp(2.25rem,4.5vw,3.25rem)] font-bold text-[var(--color-ivory)] tracking-[-0.025em] leading-[1.05]">
              Your import requests.
            </h1>
            <p className="text-[var(--color-ivory-dim)] text-[16px] leading-relaxed">
              Tell us what you want from Asia. We build a factory shortlist and a fully landed-cost
              quote — duty, VAT, freight, finance, fees — one number, one accountable party.
            </p>
          </div>
          <Link
            href="/imports/new"
            className="group inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[14px] font-semibold whitespace-nowrap transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px"
            style={{
              borderRadius: 'var(--radius-button)',
              boxShadow: 'var(--shadow-cta)',
            }}
          >
            New import request
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </header>

      {/* Sprint 23 — cohort drill-down banner. Renders when the page
          was reached from /imports/insights via a clickable decline-
          reason bar. Shows the cohort's identity + a "Back to insights"
          escape hatch so ops doesn't have to use the browser history. */}
      {cohortReason && (
        <div
          className="bg-[var(--color-aqua-soft)] border border-[var(--color-aqua)]/30 p-5 flex items-start justify-between gap-4 flex-wrap"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <div className="space-y-1.5 max-w-2xl">
            <span className="inline-block text-[10.5px] font-semibold tracking-[0.08em] uppercase text-[var(--color-aqua)]">
              Cohort · {DECLINE_REASON_LABELS[cohortReason]}
            </span>
            <p className="text-[14px] text-[var(--color-ivory)] leading-relaxed">
              Every request in your org{filterStatus ? ` at status ${statusLabel(filterStatus).toLowerCase()}` : ''} that the team declined with this reason. Triage with bulk actions on{' '}
              <Link href="/imports/queue" className="text-[var(--color-aqua)] hover:underline font-medium">
                the queue
              </Link>{' '}
              if any of these need revisiting.
            </p>
          </div>
          <Link
            href="/imports/insights"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--color-aqua)] hover:underline shrink-0"
          >
            <span aria-hidden className="rotate-180 inline-block">→</span>
            Back to insights
          </Link>
        </div>
      )}

      {/* Status filter. Sprint 23: preserve the cohort drill-down on
          chip clicks so ops can narrow a cohort by status without
          losing the cohort identity. */}
      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        <FilterChip
          label="All"
          active={!filterStatus}
          count={requests.length}
          onClick={() => router.push(cohortReason ? `/imports?declineReason=${encodeURIComponent(cohortReason)}` : '/imports')}
        />
        {IMPORT_REQUEST_STATUSES.map((s) => {
          const n = counts[s] || 0;
          if (n === 0 && filterStatus !== s) return null;
          return (
            <FilterChip
              key={s}
              label={statusLabel(s)}
              count={n}
              active={filterStatus === s}
              onClick={() => {
                const params = new URLSearchParams();
                params.set('status', s);
                if (cohortReason) params.set('declineReason', cohortReason);
                router.push(`/imports?${params.toString()}`);
              }}
              tone={statusTone(s)}
            />
          );
        })}
      </nav>

      {/* Table or empty state */}
      {state === 'loading' && <p className="text-[var(--color-ivory-mute)] text-sm">Loading…</p>}
      {state === 'error' && (
        <div
          className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/8 p-5"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <p className="text-[13px] font-semibold text-[var(--color-critical)]">Could not load requests</p>
          <p className="text-[var(--color-ivory-dim)] text-[14px] mt-1">{errorMsg}</p>
        </div>
      )}
      {state === 'ready' && requests.length === 0 && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] p-12 text-center"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          {/* Sprint 23 — different empty-state copy when ops is
              drilling into a cohort that turned out empty. */}
          {cohortReason ? (
            <>
              <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">No requests in this cohort.</p>
              <p className="text-[var(--color-ivory-mute)] text-[14px] mt-3 max-w-md mx-auto leading-relaxed">
                No declines with reason{' '}
                <span className="text-[var(--color-ivory)] font-semibold">{DECLINE_REASON_LABELS[cohortReason]}</span>
                {filterStatus ? ` and status ${statusLabel(filterStatus).toLowerCase()}` : ''} in this org{' '}
                — that's actually good news.{' '}
                <Link className="text-[var(--color-aqua)] hover:underline" href="/imports/insights">
                  Back to insights
                </Link>
                .
              </p>
            </>
          ) : (
            <>
              <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">No import requests yet.</p>
              <p className="text-[var(--color-ivory-mute)] text-[14px] mt-3">
                Start with <Link className="text-[var(--color-aqua)] hover:underline" href="/imports/new">a new request</Link> — we will surface a shortlist + landed-cost quote within a few minutes.
              </p>
            </>
          )}
        </div>
      )}
      {state === 'ready' && requests.length > 0 && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] overflow-hidden"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <table className="w-full text-left text-[14px]">
            <thead className="bg-white/[0.02] text-[var(--color-ivory-mute)]">
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
                  className="border-t border-white/[0.04] hover:bg-white/[0.025] transition-colors"
                >
                  <Td>
                    <Link
                      href={`/imports/${r.externalId}`}
                      className="text-[var(--color-ivory)] font-medium hover:text-[var(--color-aqua)] transition-colors"
                    >
                      {r.label}
                    </Link>
                    <div className="text-[11px] text-[var(--color-ivory-mute)]/70 mt-1 font-mono">
                      {r.externalId}
                    </div>
                  </Td>
                  <Td>
                    <span className="text-[var(--color-ivory-dim)] line-clamp-2">{r.productDescription}</span>
                  </Td>
                  <Td>
                    <span className="font-mono text-[12.5px] text-[var(--color-ivory-dim)]">
                      {(r.originCountry || '?')} → {r.destinationCountry}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium"
                      style={{ color: statusTone(r.status) }}
                    >
                      <span
                        aria-hidden
                        className="inline-block w-1.5 h-1.5"
                        style={{ background: statusTone(r.status), borderRadius: '999px' }}
                      />
                      {statusLabel(r.status)}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="text-[14px] text-[var(--color-ivory)] font-semibold tabular-nums">
                      {eurFromCents(r.landedQuote?.totalLandedCents ?? null)}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="text-[12px] text-[var(--color-ivory-mute)] tabular-nums">
                      {ageLabel(r.updatedAt)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note */}
      <footer className="border-t border-white/[0.06] pt-6 text-[var(--color-ivory-mute)] text-[12.5px] font-serif italic max-w-2xl leading-relaxed">
        v1 of the Operator wedge ships the customer-intent + AI-shortlist + calculator-grounded
        quote flow. Fulfilment (factory comms, customs filing, freight booking, finance) is run
        by the OrcaTrade team behind the curtain until partner integrations land in a later sprint.
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
      className={`group relative px-4 py-1.5 text-[12.5px] font-medium border transition-all duration-200 ${
        active
          ? 'border-[var(--color-aqua)] text-[var(--color-navy)] bg-[var(--color-aqua)] shadow-[0_2px_12px_rgba(34,211,238,0.3)]'
          : 'border-white/[0.08] text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] hover:border-[var(--color-aqua)]/50 hover:bg-white/[0.025]'
      }`}
      style={{ borderRadius: 'var(--radius-badge)' }}
    >
      {tone && !active && (
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 mr-2 align-middle"
          style={{ background: tone, borderRadius: '999px' }}
        />
      )}
      {label}
      <span className={`ml-2 tabular-nums ${active ? 'text-[var(--color-navy)]/70' : 'text-[var(--color-ivory-mute)]/70'}`}>
        {count}
      </span>
    </button>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return (
    <th
      className={`px-5 py-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return (
    <td className={`px-5 py-4 align-top ${align === 'right' ? 'text-right' : ''}`}>{children}</td>
  );
}
