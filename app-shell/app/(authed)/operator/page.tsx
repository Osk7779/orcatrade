'use client';

// Operator triage console — sprint 87 (Track E: operator leverage).
//
// The whole book of business on one screen: every org's open work,
// ranked server-side by SLA risk → € at stake → review queue. This
// is the surface that lets one operator run a hundred orgs.
//
// ADMIN-ONLY: /api/operator-triage gates on the platform-staff
// allowlist. An org-scoped session gets a 401 and this page renders
// its team-only state — no cross-org data ever reaches a customer
// browser.

import { Fragment, useEffect, useState } from 'react';
import {
  apiGet,
  AuthError,
  type OperatorTriageResponse,
  type OperatorTriageRow,
  type OperatorTriageDetailResponse,
} from '@/lib/api';

type LoadState = 'loading' | 'forbidden' | 'error' | 'ready';

function eurFromCents(cents: number): string {
  if (!Number.isFinite(cents)) return '—';
  return '€' + Math.round(cents / 100).toLocaleString('en-IE');
}

export default function OperatorTriagePage() {
  const [state, setState] = useState<LoadState>('loading');
  const [rows, setRows] = useState<OperatorTriageRow[]>([]);
  const [riskHours, setRiskHours] = useState<number>(36);
  const [targetHours, setTargetHours] = useState<number>(48);
  const [generatedAt, setGeneratedAt] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState('');
  // Sprint 90 — drill-down: one expanded org at a time; fetched
  // details cached per org so re-expanding is instant.
  const [expandedOrg, setExpandedOrg] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, OperatorTriageDetailResponse>>({});
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiGet<OperatorTriageResponse>('/operator-triage')
      .then((d) => {
        if (cancelled) return;
        setRows(Array.isArray(d.rows) ? d.rows : []);
        setRiskHours(d.slaRiskThresholdHours);
        setTargetHours(d.slaTargetHours);
        setGeneratedAt(d.generatedAt || '');
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) setState('forbidden');
        else {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load the triage feed');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleExpand(orgId: number) {
    setDetailError('');
    if (expandedOrg === orgId) {
      setExpandedOrg(null);
      return;
    }
    setExpandedOrg(orgId);
    if (!details[orgId]) {
      try {
        const d = await apiGet<OperatorTriageDetailResponse>(`/operator-triage?org=${orgId}`);
        setDetails((prev) => ({ ...prev, [orgId]: d }));
      } catch (err) {
        setDetailError(err instanceof Error ? err.message : 'Could not load the org worklist');
      }
    }
  }

  if (state === 'forbidden') {
    return (
      <section className="space-y-4 pt-4">
        <h1 className="text-3xl font-bold text-[var(--color-ivory)]">Operator console</h1>
        <p className="text-[var(--color-ivory-dim)] text-[15px] max-w-xl leading-relaxed">
          This console is for the OrcaTrade operations team — it reads across every
          organisation, so it gates on the platform-staff allowlist. Your own org&rsquo;s
          worklist lives on the{' '}
          <a href="/app/imports/insights" className="text-[var(--color-aqua)] hover:underline">
            Ops Insights cockpit
          </a>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-8 pb-16 pt-4">
      <header className="space-y-3">
        <span className="inline-block text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
          Platform staff · cross-org
        </span>
        <h1 className="text-3xl font-bold text-[var(--color-ivory)] tracking-[-0.02em]">
          Operator triage
        </h1>
        <p className="text-[var(--color-ivory-dim)] text-[15px] max-w-2xl leading-relaxed">
          Every org, ranked by urgency: SLA risk first (unquoted past {riskHours}h of the{' '}
          {targetHours}h budget), then open-quote € at stake, then the review queue. Work the
          list top to bottom.
        </p>
        {generatedAt && (
          <p className="text-[11.5px] text-[var(--color-ivory-mute)] font-mono">
            as of {String(generatedAt).slice(0, 10)} {String(generatedAt).slice(11, 19)} UTC · no
            cache — reload for fresh
          </p>
        )}
      </header>

      {state === 'loading' && <p className="text-[var(--color-ivory-mute)] text-sm">Loading…</p>}
      {state === 'error' && (
        <div
          className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/8 p-5"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <p className="text-[13px] font-semibold text-[var(--color-critical)]">
            Could not load the triage feed
          </p>
          <p className="text-[var(--color-ivory-dim)] text-[14px] mt-1">{errorMsg}</p>
        </div>
      )}
      {state === 'ready' && rows.length === 0 && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] p-12 text-center"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">
            No open work anywhere in the book.
          </p>
        </div>
      )}
      {state === 'ready' && rows.length > 0 && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] overflow-hidden"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <table className="w-full text-left text-[14px]">
            <thead className="bg-white/[0.02] text-[var(--color-ivory-mute)]">
              <tr>
                <th className="px-5 py-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase">Org</th>
                <th className="px-5 py-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase text-right">SLA risk</th>
                <th className="px-5 py-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase text-right">Awaiting review</th>
                <th className="px-5 py-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase text-right">In flight</th>
                <th className="px-5 py-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase text-right">Open quotes</th>
                <th className="px-5 py-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase text-right">€ at stake</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.orgExternalId || String(r.orgId)}>
                <tr
                  onClick={() => toggleExpand(r.orgId)}
                  className="border-t border-white/[0.04] hover:bg-white/[0.025] transition-colors cursor-pointer"
                  data-testid="triage-org-row"
                >
                  <td className="px-5 py-4">
                    <p className="text-[var(--color-ivory)] font-medium">{r.orgName || r.orgExternalId}</p>
                    <p className="text-[11px] text-[var(--color-ivory-mute)]/70 font-mono pt-0.5">
                      {r.orgExternalId}
                    </p>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span
                      className={`font-mono font-semibold tabular-nums ${
                        r.slaRisk > 0 ? 'text-[var(--color-critical)]' : 'text-[var(--color-ivory-mute)]'
                      }`}
                    >
                      {r.slaRisk}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right font-mono tabular-nums text-[var(--color-warning)]">
                    {r.awaitingReview}
                  </td>
                  <td className="px-5 py-4 text-right font-mono tabular-nums text-[var(--color-ivory-dim)]">
                    {r.inFlight}
                  </td>
                  <td className="px-5 py-4 text-right font-mono tabular-nums text-[var(--color-ivory-dim)]">
                    {r.openQuotes}
                  </td>
                  <td className="px-5 py-4 text-right font-mono font-semibold tabular-nums text-[var(--color-ivory)]">
                    {eurFromCents(r.openQuoteValueCents)}
                  </td>
                </tr>
                {/* Sprint 90 — drill-down sub-row. One org expanded
                    at a time; buckets are capped + urgency-ordered
                    server-side. Read-only: acting on a row still
                    happens inside that org's context. */}
                {expandedOrg === r.orgId && (
                  <tr className="border-t border-white/[0.04] bg-white/[0.015]" data-testid="triage-detail-row">
                    <td colSpan={6} className="px-5 py-5">
                      {detailError && (
                        <p className="text-[12.5px] text-[var(--color-warning)]">{detailError}</p>
                      )}
                      {!detailError && !details[r.orgId] && (
                        <p className="text-[12.5px] text-[var(--color-ivory-mute)]">Loading worklist…</p>
                      )}
                      {details[r.orgId] && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          {([
                            ['At risk (oldest first)', details[r.orgId].atRisk, 'var(--color-critical)'],
                            ['Awaiting review (oldest first)', details[r.orgId].awaiting, 'var(--color-warning)'],
                            ['Open quotes (value first)', details[r.orgId].quoted, 'var(--color-ivory)'],
                          ] as const).map(([title, items, tone]) => (
                            <div key={title} className="space-y-2">
                              <p className="text-[10.5px] uppercase tracking-[0.08em] font-semibold" style={{ color: tone }}>
                                {title}
                              </p>
                              {items.length === 0 ? (
                                <p className="text-[12px] text-[var(--color-ivory-mute)] italic">none</p>
                              ) : (
                                <ul className="space-y-1.5">
                                  {items.map((item) => (
                                    <li key={item.externalId} className="text-[12.5px] leading-snug">
                                      <span className="text-[var(--color-ivory)]">{item.label || item.externalId}</span>
                                      <span className="text-[var(--color-ivory-mute)] font-mono">
                                        {' '}· {item.externalId} · {Math.round(item.ageHours)}h
                                        {item.landedCents != null ? ` · ${eurFromCents(item.landedCents)}` : ''}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <footer className="border-t border-white/[0.06] pt-6 text-[var(--color-ivory-mute)] text-[12.5px] font-serif italic max-w-2xl leading-relaxed">
        Ranking is deterministic and computed in SQL — SLA risk, then value at stake, then the
        review queue. v1 is read-only; per-org drill-down requires that org&rsquo;s context.
      </footer>
    </section>
  );
}
