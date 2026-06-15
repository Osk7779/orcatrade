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
        <h1 className="font-serif text-3xl text-[var(--color-ivory)]">Review queue</h1>
        <p className="text-[var(--color-ivory-mute)] text-sm">
          Please <a href="/account/" className="underline hover:text-[var(--color-ivory)]">sign in</a> to see the queue.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-10">
      <header className="space-y-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
            Ops · L1.0 review queue
          </span>
        </div>
        <h1 className="font-serif text-4xl text-[var(--color-ivory)] tracking-[-0.02em]">
          Review queue
        </h1>
        <p className="text-[var(--color-ivory-mute)] text-[15px] max-w-2xl leading-relaxed">
          AI-generated shortlists and landed-cost quotes waiting for team eyes before they reach the customer.
          ADR 0015 human gate — every customer-facing artefact crosses this desk.
        </p>
      </header>

      {actionError && (
        <div className="border border-[var(--color-critical)]/35 bg-[var(--color-critical)]/10 p-3">
          <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-[var(--color-critical)]">{actionError}</p>
        </div>
      )}

      {state === 'loading' && <p className="text-[var(--color-ivory-mute)] text-sm">Loading queue…</p>}
      {state === 'error' && (
        <div className="border border-[var(--color-critical)]/35 bg-[var(--color-critical)]/10 p-4">
          <p className="font-mono text-[12px] tracking-[0.1em] uppercase text-[var(--color-critical)]">Could not load the queue</p>
          <p className="text-[var(--color-ivory-mute)] text-sm mt-1">{errorMsg}</p>
        </div>
      )}
      {state === 'ready' && items.length === 0 && (
        <div className="border border-[var(--color-navy-line)] p-10 text-center">
          <p className="font-serif italic text-[var(--color-ivory-mute)] text-lg">Queue is empty.</p>
          <p className="text-[var(--color-ivory-mute)] text-sm mt-2">
            Nothing currently awaits team review. New submissions will appear here as the orchestrator finishes them.
          </p>
        </div>
      )}
      {state === 'ready' && items.length > 0 && (
        <ul className="space-y-4">
          {items.map((r) => (
            <li
              key={r.externalId}
              className="border border-[var(--color-navy-line)] hover:border-[var(--color-ivory-mute)] transition-colors"
            >
              <div className="p-5 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_auto] gap-5 items-start">
                {/* Identity + intent */}
                <div className="space-y-2">
                  <div className="flex items-baseline gap-3">
                    <Link
                      href={`/imports/${r.externalId}`}
                      className="font-serif text-xl text-[var(--color-ivory)] hover:underline"
                    >
                      {r.label}
                    </Link>
                    <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-[var(--color-ivory-mute)]">
                      {r.externalId}
                    </span>
                  </div>
                  <p className="text-[var(--color-ivory-dim)] text-[13.5px] line-clamp-2 max-w-xl">
                    {r.productDescription}
                  </p>
                  <div className="flex flex-wrap gap-3 text-[12px] font-mono text-[var(--color-ivory-mute)]">
                    <span>{(r.originCountry || '?')} → {r.destinationCountry}</span>
                    {r.targetQuantity && (
                      <span>· {r.targetQuantity.toLocaleString('en-IE')} {r.targetQuantityUnit?.replace(/_/g, ' ')}</span>
                    )}
                    {r.targetDeliveryDate && <span>· need {r.targetDeliveryDate}</span>}
                  </div>
                </div>

                {/* Quote summary */}
                <div className="space-y-1">
                  <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-[var(--color-ivory-mute)]">
                    Landed total
                  </div>
                  <div className="font-serif text-2xl text-[var(--color-ivory)]">
                    {eurFromCents(r.landedQuote?.totalLandedCents ?? null)}
                  </div>
                  {r.landedQuote && (
                    <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-[var(--color-ivory-mute)]">
                      Tier {r.landedQuote.confidenceTier} · {r.landedQuote.orcatradeFeePct}% take-rate
                      {r.landedQuote.confidenceNotes.length > 0 && (
                        <span className="ml-2 text-[var(--color-warning)]">
                          {r.landedQuote.confidenceNotes.length} warning{r.landedQuote.confidenceNotes.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="font-serif italic text-[11px] text-[var(--color-ivory-mute)] pt-1">
                    Waiting {ageLabel(r.updatedAt)}
                  </div>
                </div>

                {/* Quick actions */}
                <div className="flex flex-col gap-2 lg:items-end">
                  <Link
                    href={`/imports/${r.externalId}`}
                    className="inline-flex items-center justify-center px-3 py-2 border border-[var(--color-ivory)]/40 text-[var(--color-ivory)] font-mono text-[10.5px] tracking-[0.14em] uppercase hover:bg-[var(--color-navy-soft)]/60 transition-colors"
                  >
                    Open full review
                  </Link>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => review(r.externalId, 'approved')}
                      disabled={!!actionPending}
                      className="px-3 py-2 bg-[var(--color-ivory)] text-[var(--color-navy)] font-mono text-[10.5px] tracking-[0.14em] uppercase hover:bg-[var(--color-ivory-dim)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {actionPending === r.externalId + ':approved' ? 'Sending…' : 'Send →'}
                    </button>
                    <button
                      type="button"
                      onClick={() => review(r.externalId, 'sent_back')}
                      disabled={!!actionPending}
                      className="px-3 py-2 border border-[var(--color-navy-line)] text-[var(--color-ivory-dim)] font-mono text-[10.5px] tracking-[0.14em] uppercase hover:text-[var(--color-ivory)] hover:border-[var(--color-ivory-mute)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

      <footer className="border-t border-[var(--color-navy-line)] pt-6 text-[var(--color-ivory-mute)] text-[12px] font-serif italic max-w-2xl leading-relaxed">
        “Send →” transitions <code className="font-mono not-italic text-[11px]">awaiting_review → quoted</code> and the customer sees the
        shortlist + quote in their own detail view. “Back” transitions to{' '}
        <code className="font-mono not-italic text-[11px]">processing</code> so the orchestrator can re-run after the inputs are corrected.
      </footer>
    </section>
  );
}
