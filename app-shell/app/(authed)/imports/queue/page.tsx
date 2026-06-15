'use client';

// /imports/queue — team review surface.
//
// Reads:
//   GET /api/imports?status=awaiting_review  → ImportRequest[]
//   (NOT scoped to ?mine — v1 shows all org-wide requests in this
//    status. RBAC enforcement that hides this page from non-team
//    members is sprint 2 work; the data layer is org-scoped so a
//    customer signed in to their own org just sees their own
//    awaiting-review items here.)
//
// Acts:
//   POST /api/imports/<id>/review { decision: 'approved'|'sent_back'|'rejected' }
//
// The page is deliberately a triage list, not a deep review surface.
// The deep review happens in /imports/[externalId] where the team can
// see the full shortlist + quote. This page just lets the team see
// what's in the queue + quickly take obvious actions.

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  apiGet,
  apiPost,
  ApiError,
  AuthError,
  deriveComplianceBadges,
  matchesComplianceFilter,
  complianceFilterLabel,
  COMPLIANCE_QUEUE_FILTERS,
  type ComplianceBadge,
  type ComplianceBadgeTone,
  type ComplianceQueueFilter,
  type ImportRequest,
} from '@/lib/api';

type LoadState = 'loading' | 'auth' | 'error' | 'ready';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + Math.round(cents / 100).toLocaleString('en-IE');
}

function ageLabel(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) {
    const d = Math.floor(hours / 24);
    return `${d}d ${hours - d * 24}h`;
  }
  if (hours >= 1) return `${hours}h`;
  const mins = Math.floor(ms / 60_000);
  return mins >= 1 ? `${mins}m` : 'just now';
}

export default function QueuePage() {
  return (
    <Suspense fallback={<p className="text-white/50 text-sm">Loading review queue…</p>}>
      <QueueView />
    </Suspense>
  );
}

function QueueView() {
  const [state, setState] = useState<LoadState>('loading');
  const [items, setItems] = useState<ImportRequest[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  // Sprint 8 ch 2: compliance-driven triage filter. Local state — not
  // URL-backed, because the queue is a working surface and operators
  // change filters constantly. Persist via URL when team sizes grow.
  const [complianceFilter, setComplianceFilter] = useState<ComplianceQueueFilter>('all');

  const load = useCallback(() => {
    setState('loading');
    apiGet<{ ok: boolean; importRequests: ImportRequest[] }>('/imports?status=awaiting_review')
      .then((d) => {
        setItems(Array.isArray(d.importRequests) ? d.importRequests : []);
        setState('ready');
      })
      .catch((err) => {
        if (err instanceof AuthError) setState('auth');
        else {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load the queue');
          setState('error');
        }
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; importRequests: ImportRequest[] }>('/imports?status=awaiting_review')
      .then((d) => {
        if (cancelled) return;
        setItems(Array.isArray(d.importRequests) ? d.importRequests : []);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) setState('auth');
        else {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load the queue');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sprint 8 ch 2 — derive the filter chip counts and the visible
  // list. Computing in one pass avoids re-running deriveComplianceBadges
  // three times (once for count, once for filter, once for render).
  const decorated = items.map((r) => ({
    request: r,
    badges: deriveComplianceBadges(r.landedQuote?.complianceProbes ?? null),
  }));
  const counts = COMPLIANCE_QUEUE_FILTERS.reduce<Record<ComplianceQueueFilter, number>>((acc, f) => {
    acc[f] = decorated.filter((d) => matchesComplianceFilter(d.badges, f)).length;
    return acc;
  }, {} as Record<ComplianceQueueFilter, number>);
  const filtered = decorated.filter((d) => matchesComplianceFilter(d.badges, complianceFilter));

  async function review(externalId: string, decision: 'approved' | 'sent_back' | 'rejected') {
    setActionPending(externalId + ':' + decision);
    setActionError('');
    try {
      await apiPost(`/imports/${externalId}/review`, { decision });
      load();
    } catch (err) {
      if (err instanceof ApiError) setActionError(err.errors.length ? err.errors.join('; ') : err.message);
      else setActionError(err instanceof Error ? err.message : 'Review action failed');
    } finally {
      setActionPending(null);
    }
  }

  if (state === 'auth') {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-ivory)]">Review queue</h1>
        <p className="text-[var(--color-ivory-mute)] text-sm">
          Please <a href="/account/" className="text-[var(--color-aqua)] hover:underline">sign in</a> to see the queue.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-12 pb-16">
      {/* Hero */}
      <header className="relative pt-4">
        <div
          aria-hidden
          className="absolute -top-8 -right-8 w-64 h-64 pointer-events-none rounded-full"
          style={{
            background: 'radial-gradient(closest-side, var(--color-aqua-glow), transparent)',
            filter: 'blur(8px)',
          }}
        />
        <div className="relative space-y-4 max-w-2xl">
          <span className="inline-block text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
            Ops · L1.0 review queue
          </span>
          <h1 className="text-[clamp(2.25rem,4.5vw,3.25rem)] font-bold text-[var(--color-ivory)] tracking-[-0.025em] leading-[1.05]">
            Review queue.
          </h1>
          <p className="text-[var(--color-ivory-dim)] text-[16px] leading-relaxed">
            AI-generated shortlists and landed-cost quotes waiting for team eyes before they reach the customer.
            ADR 0015 human gate — every customer-facing artefact crosses this desk.
          </p>
        </div>
      </header>

      {actionError && (
        <div
          className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/8 p-4"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <p className="text-[13px] font-semibold text-[var(--color-critical)]">{actionError}</p>
        </div>
      )}

      {/* Compliance triage filter — sprint 8 ch 2 */}
      {state === 'ready' && items.length > 0 && (
        <nav className="flex flex-wrap gap-2" aria-label="Filter queue by compliance exposure">
          {COMPLIANCE_QUEUE_FILTERS.map((f) => {
            const n = counts[f];
            const active = complianceFilter === f;
            if (n === 0 && !active && f !== 'all') return null;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setComplianceFilter(f)}
                className={`group relative px-4 py-1.5 text-[12.5px] font-medium border transition-all duration-200 ${
                  active
                    ? 'border-[var(--color-aqua)] text-[var(--color-navy)] bg-[var(--color-aqua)] shadow-[0_2px_12px_rgba(34,211,238,0.3)]'
                    : 'border-white/[0.08] text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] hover:border-[var(--color-aqua)]/50 hover:bg-white/[0.025]'
                }`}
                style={{ borderRadius: 'var(--radius-badge)' }}
              >
                {complianceFilterLabel(f)}
                <span className={`ml-2 tabular-nums ${active ? 'text-[var(--color-navy)]/70' : 'text-[var(--color-ivory-mute)]/70'}`}>
                  {n}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {state === 'loading' && <p className="text-[var(--color-ivory-mute)] text-sm">Loading queue…</p>}
      {state === 'error' && (
        <div
          className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/8 p-5"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <p className="text-[13px] font-semibold text-[var(--color-critical)]">Could not load the queue</p>
          <p className="text-[var(--color-ivory-dim)] text-[14px] mt-1">{errorMsg}</p>
        </div>
      )}
      {state === 'ready' && items.length === 0 && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] p-12 text-center"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">Queue is empty.</p>
          <p className="text-[var(--color-ivory-mute)] text-[14px] mt-3">
            Nothing currently awaits team review. New submissions will appear here as the orchestrator finishes them.
          </p>
        </div>
      )}
      {state === 'ready' && items.length > 0 && filtered.length === 0 && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] p-10 text-center"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="text-[var(--color-ivory-dim)] text-[14.5px]">
            No requests match the <span className="text-[var(--color-aqua)] font-semibold">{complianceFilterLabel(complianceFilter)}</span> filter.
          </p>
          <button
            type="button"
            onClick={() => setComplianceFilter('all')}
            className="mt-3 text-[12.5px] text-[var(--color-aqua)] hover:underline font-medium"
          >
            Show all {items.length}
          </button>
        </div>
      )}
      {state === 'ready' && filtered.length > 0 && (
        <ul className="space-y-4">
          {filtered.map(({ request: r }) => (
            <li
              key={r.externalId}
              className="bg-[var(--surface-card)] border border-white/[0.06] hover:border-[var(--color-aqua)]/30 transition-all duration-200 hover:shadow-[var(--shadow-card-hover)]"
              style={{
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div className="p-6 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_auto] gap-6 items-start">
                {/* Identity + intent */}
                <div className="space-y-2">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <Link
                      href={`/imports/${r.externalId}`}
                      className="text-[20px] font-semibold text-[var(--color-ivory)] hover:text-[var(--color-aqua)] transition-colors"
                    >
                      {r.label}
                    </Link>
                    <span className="font-mono text-[11px] text-[var(--color-ivory-mute)]/70">
                      {r.externalId}
                    </span>
                  </div>
                  <p className="text-[var(--color-ivory-dim)] text-[14px] line-clamp-2 max-w-xl leading-relaxed">
                    {r.productDescription}
                  </p>
                  <div className="flex flex-wrap gap-3 text-[12.5px] text-[var(--color-ivory-mute)]">
                    <span className="font-mono">{(r.originCountry || '?')} → {r.destinationCountry}</span>
                    {r.targetQuantity && (
                      <span>· {r.targetQuantity.toLocaleString('en-IE')} {r.targetQuantityUnit?.replace(/_/g, ' ')}</span>
                    )}
                    {r.targetDeliveryDate && <span>· need {r.targetDeliveryDate}</span>}
                  </div>
                </div>

                {/* Quote summary */}
                <div className="space-y-1">
                  <div className="text-[10.5px] font-semibold tracking-[0.1em] uppercase text-[var(--color-ivory-mute)]">
                    Landed total
                  </div>
                  <div className="text-[28px] font-bold text-[var(--color-ivory)] tracking-[-0.015em] tabular-nums">
                    {eurFromCents(r.landedQuote?.totalLandedCents ?? null)}
                  </div>
                  {r.landedQuote && (
                    <div className="text-[12px] text-[var(--color-ivory-mute)]">
                      Tier {r.landedQuote.confidenceTier} · {r.landedQuote.orcatradeFeePct}% take-rate
                      {r.landedQuote.confidenceNotes.length > 0 && (
                        <span className="ml-2 text-[var(--color-warning)] font-medium">
                          {r.landedQuote.confidenceNotes.length} warning{r.landedQuote.confidenceNotes.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  )}
                  <ComplianceBadgeRow
                    badges={deriveComplianceBadges(r.landedQuote?.complianceProbes ?? null)}
                  />
                  <div className="text-[11.5px] text-[var(--color-ivory-mute)] pt-2">
                    Waiting {ageLabel(r.updatedAt)}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex flex-col gap-2 lg:items-end">
                  <Link
                    href={`/imports/${r.externalId}`}
                    className="inline-flex items-center justify-center px-4 py-2 border border-white/[0.12] text-[var(--color-ivory)] text-[12.5px] font-medium hover:border-[var(--color-aqua)]/60 hover:text-[var(--color-aqua)] hover:bg-white/[0.025] transition-all duration-200"
                    style={{ borderRadius: 'var(--radius-button)' }}
                  >
                    Open full review
                  </Link>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => review(r.externalId, 'approved')}
                      disabled={!!actionPending}
                      className="px-4 py-2 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[12.5px] font-semibold transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
                      style={{
                        borderRadius: 'var(--radius-button)',
                        boxShadow: actionPending ? 'none' : 'var(--shadow-cta)',
                      }}
                    >
                      {actionPending === r.externalId + ':approved' ? 'Sending…' : 'Send →'}
                    </button>
                    <button
                      type="button"
                      onClick={() => review(r.externalId, 'sent_back')}
                      disabled={!!actionPending}
                      className="px-4 py-2 border border-white/[0.12] text-[var(--color-ivory-dim)] text-[12.5px] font-medium transition-all duration-200 hover:text-[var(--color-ivory)] hover:border-white/[0.25] hover:bg-white/[0.025] disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ borderRadius: 'var(--radius-button)' }}
                    >
                      Back
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="border-t border-white/[0.06] pt-6 text-[var(--color-ivory-mute)] text-[12.5px] font-serif italic max-w-2xl leading-relaxed">
        "Send →" transitions <code className="font-mono not-italic text-[11px]">awaiting_review → quoted</code> and the customer sees the
        shortlist + quote in their own detail view. "Back" transitions to{' '}
        <code className="font-mono not-italic text-[11px]">processing</code> so the orchestrator can re-run after the inputs are corrected.
      </footer>
    </section>
  );
}

function badgeToneStyle(tone: ComplianceBadgeTone): {
  color: string;
  borderColor: string;
  background: string;
} {
  // in-scope: warning (the team needs to do extra work — CBAM filing etc.)
  // verify: ivory-mute (informational — REACH applies in principle, verify against SDS)
  if (tone === 'in-scope') {
    return {
      color: 'var(--color-warning)',
      borderColor: 'var(--color-warning)',
      background: 'rgba(245,158,11,0.08)',
    };
  }
  return {
    color: 'var(--color-ivory-mute)',
    borderColor: 'var(--color-navy-line)',
    background: 'transparent',
  };
}

function ComplianceBadgeRow({ badges }: { badges: ComplianceBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {badges.map(({ regime, short, tone }) => {
        const style = badgeToneStyle(tone);
        return (
          <span
            key={regime}
            className="inline-flex items-center px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.04em] border"
            style={{ ...style, borderRadius: 'var(--radius-badge)' }}
            title={`${short} ${tone === 'in-scope' ? 'in scope — team action required' : 'verify — review the detail view'}`}
          >
            {short}
            {tone === 'verify' && <span aria-hidden className="ml-1">?</span>}
          </span>
        );
      })}
    </div>
  );
}
