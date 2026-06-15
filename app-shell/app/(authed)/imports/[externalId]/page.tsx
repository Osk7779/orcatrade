'use client';

// /imports/[externalId] — request detail.
//
// Reads:
//   GET /api/imports/<id>
//
// Acts (per state):
//   awaiting_review → POST /<id>/review { decision, notes }
//                     (team-side; surfaces because for v1 RBAC isn't
//                     enforced — sprint 2 hides this for non-team users)
//   quoted          → POST /<id>/decide { decision: 'approved'|'rejected', notes }
//   any non-terminal → POST /<id>/cancel { reason? }
//   any state       → POST /<id>/process to (re)run orchestrator when
//                     status === 'submitted' or 'failed' (with recoverable: true)

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  apiGet,
  apiPost,
  ApiError,
  AuthError,
  type ImportRequest,
  type ImportRequestStatus,
  type FactoryShortlistBlock,
  type LandedQuote,
  type LandedQuoteComponent,
} from '@/lib/api';

type LoadState = 'loading' | 'auth' | 'error' | 'ready';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + (Math.round(cents) / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function tierLabel(t?: string) {
  if (t === 'A') return 'Tier A · liability-bearing';
  if (t === 'B') return 'Tier B · calculator-grounded';
  if (t === 'C') return 'Tier C · heuristic';
  return 'Tier —';
}

export default function ImportRequestDetailPage() {
  const params = useParams<{ externalId: string }>();
  const router = useRouter();
  const externalId = String(params.externalId || '');

  const [state, setState] = useState<LoadState>('loading');
  const [request, setRequest] = useState<ImportRequest | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>('');

  const reload = useCallback(() => {
    setState('loading');
    apiGet<{ ok: boolean; importRequest: ImportRequest }>(`/imports/${externalId}`)
      .then((d) => {
        setRequest(d.importRequest);
        setState('ready');
      })
      .catch((err) => {
        if (err instanceof AuthError) setState('auth');
        else {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load this request');
          setState('error');
        }
      });
  }, [externalId]);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; importRequest: ImportRequest }>(`/imports/${externalId}`)
      .then((d) => {
        if (cancelled) return;
        setRequest(d.importRequest);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) setState('auth');
        else {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load this request');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [externalId]);

  async function act(label: string, fn: () => Promise<void>) {
    setActionPending(label);
    setActionError('');
    try {
      await fn();
      reload();
    } catch (err) {
      if (err instanceof ApiError) {
        setActionError(err.errors.length ? err.errors.join('; ') : err.message);
      } else {
        setActionError(err instanceof Error ? err.message : 'Action failed');
      }
    } finally {
      setActionPending(null);
    }
  }

  if (state === 'auth') {
    return (
      <section className="space-y-4">
        <p className="text-[var(--color-ivory-mute)] text-sm">
          Please <a href="/account/" className="underline hover:text-[var(--color-ivory)]">sign in</a>.
        </p>
      </section>
    );
  }
  if (state === 'loading' || !request) {
    return (
      <section className="space-y-4">
        <p className="text-[var(--color-ivory-mute)] text-sm">Loading import request…</p>
      </section>
    );
  }
  if (state === 'error') {
    return (
      <section className="space-y-4">
        <p className="font-mono text-[12px] tracking-[0.1em] uppercase text-[var(--color-critical)]">Could not load</p>
        <p className="text-[var(--color-ivory-mute)] text-sm">{errorMsg}</p>
      </section>
    );
  }

  const tone = statusTone(request.status);
  const isTerminal =
    request.status === 'customer_approved' ||
    request.status === 'customer_rejected' ||
    request.status === 'expired' ||
    request.status === 'cancelled' ||
    request.status === 'failed';

  return (
    <article className="space-y-12">
      {/* Header */}
      <header className="space-y-4">
        <Link href="/imports" className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)]">
          ← All imports
        </Link>
        <div className="flex items-start justify-between gap-6">
          <div className="space-y-2">
            <h1 className="font-serif text-4xl text-[var(--color-ivory)] tracking-[-0.02em]">
              {request.label}
            </h1>
            <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-[var(--color-ivory-mute)]">
              {request.externalId}
            </p>
          </div>
          <span
            className="inline-flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] uppercase border"
            style={{ color: tone, borderColor: tone }}
          >
            <span aria-hidden className="inline-block w-1.5 h-1.5" style={{ background: tone }} />
            {statusLabel(request.status)}
          </span>
        </div>
      </header>

      {/* Action zone */}
      <ActionZone
        request={request}
        actionPending={actionPending}
        actionError={actionError}
        onProcess={() =>
          act('processing', async () => {
            await apiPost(`/imports/${request.externalId}/process`, {});
          })
        }
        onApprove={() =>
          act('approving', async () => {
            await apiPost(`/imports/${request.externalId}/decide`, { decision: 'approved' });
          })
        }
        onReject={() =>
          act('rejecting', async () => {
            await apiPost(`/imports/${request.externalId}/decide`, { decision: 'rejected' });
          })
        }
        onCancel={() =>
          act('cancelling', async () => {
            await apiPost(`/imports/${request.externalId}/cancel`, {});
          })
        }
        onTeamApprove={() =>
          act('team-approving', async () => {
            await apiPost(`/imports/${request.externalId}/review`, { decision: 'approved' });
          })
        }
        onTeamSendBack={() =>
          act('team-sending-back', async () => {
            await apiPost(`/imports/${request.externalId}/review`, { decision: 'sent_back', notes: 'Re-run with refined inputs' });
          })
        }
      />

      {/* Failure state */}
      {request.status === 'failed' && request.failureState && (
        <FailurePanel state={request.failureState} />
      )}

      {/* Two-column: intent + landed quote */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-10">
        <IntentPanel request={request} />
        {request.landedQuote
          ? <QuotePanel quote={request.landedQuote} expires={request.quoteExpiresAt} />
          : <PendingPanel status={request.status} />}
      </div>

      {/* Factory shortlist */}
      {request.factoryShortlist && request.factoryShortlist.length > 0 && (
        <ShortlistPanel shortlist={request.factoryShortlist} />
      )}

      {/* Audit trail link / footer */}
      <footer className="border-t border-[var(--color-navy-line)] pt-4 text-[var(--color-ivory-mute)] text-[12px] font-serif italic">
        Created {new Date(request.createdAt).toLocaleString('en-IE')} · last updated {new Date(request.updatedAt).toLocaleString('en-IE')}
        {request.linkedShipmentExternalId && (
          <>
            {' '}· materialised as{' '}
            <Link href={`/shipments/${request.linkedShipmentExternalId}`} className="underline hover:text-[var(--color-ivory)]">
              shipment {request.linkedShipmentExternalId}
            </Link>
          </>
        )}
      </footer>
    </article>
  );
}

function ActionZone({
  request,
  actionPending,
  actionError,
  onProcess,
  onApprove,
  onReject,
  onCancel,
  onTeamApprove,
  onTeamSendBack,
}: {
  request: ImportRequest;
  actionPending: string | null;
  actionError: string;
  onProcess: () => void;
  onApprove: () => void;
  onReject: () => void;
  onCancel: () => void;
  onTeamApprove: () => void;
  onTeamSendBack: () => void;
}) {
  const s = request.status;
  if (s === 'customer_approved') {
    return (
      <Banner tone="positive">
        Approved. Our team has picked it up — you will get an email when the factory PO is acknowledged.
      </Banner>
    );
  }
  if (s === 'customer_rejected' || s === 'cancelled' || s === 'expired') {
    return (
      <Banner tone="neutral">
        This request is closed. Start a <Link href="/imports/new" className="underline">new request</Link> if you want to revise inputs and try again.
      </Banner>
    );
  }
  const buttons: React.ReactNode[] = [];
  if (s === 'submitted') {
    buttons.push(
      <PrimaryButton key="process" onClick={onProcess} disabled={!!actionPending}>
        {actionPending === 'processing' ? 'Running…' : 'Generate shortlist + quote'}
      </PrimaryButton>,
    );
  }
  if (s === 'awaiting_review') {
    buttons.push(
      <PrimaryButton key="team-approve" onClick={onTeamApprove} disabled={!!actionPending}>
        {actionPending === 'team-approving' ? 'Sending…' : 'Send to customer (team)'}
      </PrimaryButton>,
      <SecondaryButton key="team-back" onClick={onTeamSendBack} disabled={!!actionPending}>
        Send back to processing
      </SecondaryButton>,
    );
  }
  if (s === 'quoted') {
    buttons.push(
      <PrimaryButton key="approve" onClick={onApprove} disabled={!!actionPending}>
        {actionPending === 'approving' ? 'Approving…' : 'Approve quote'}
      </PrimaryButton>,
      <SecondaryButton key="reject" onClick={onReject} disabled={!!actionPending}>
        Reject quote
      </SecondaryButton>,
    );
  }
  if (s === 'failed') {
    buttons.push(
      <PrimaryButton key="process" onClick={onProcess} disabled={!!actionPending}>
        {actionPending === 'processing' ? 'Re-running…' : 'Re-run orchestrator'}
      </PrimaryButton>,
    );
  }
  // Cancel is available on any non-terminal state.
  buttons.push(
    <SecondaryButton key="cancel" onClick={onCancel} disabled={!!actionPending}>
      Cancel request
    </SecondaryButton>,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">{buttons}</div>
      {actionError && (
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-[var(--color-critical)]">
          {actionError}
        </p>
      )}
    </div>
  );
}

function IntentPanel({ request }: { request: ImportRequest }) {
  return (
    <section className="space-y-4">
      <h2 className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
        What you asked for
      </h2>
      <p className="text-[var(--color-ivory)] text-[15px] leading-relaxed whitespace-pre-wrap">
        {request.productDescription}
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 pt-4 border-t border-[var(--color-navy-line)] text-[13px]">
        <DefRow label="Route">
          <span className="font-mono">{request.originCountry || '?'} → {request.destinationCountry}</span>
        </DefRow>
        <DefRow label="Quantity">
          {request.targetQuantity
            ? <span className="font-mono">{request.targetQuantity.toLocaleString('en-IE')} {request.targetQuantityUnit?.replace(/_/g, ' ')}</span>
            : <span className="text-[var(--color-ivory-mute)]">—</span>}
        </DefRow>
        <DefRow label="Target unit price">
          {request.targetUnitPriceCents != null
            ? <span className="font-mono">{eurFromCents(request.targetUnitPriceCents)}</span>
            : <span className="text-[var(--color-ivory-mute)]">—</span>}
        </DefRow>
        <DefRow label="Target delivery">
          {request.targetDeliveryDate
            ? <span className="font-mono">{request.targetDeliveryDate}</span>
            : <span className="text-[var(--color-ivory-mute)]">—</span>}
        </DefRow>
        <DefRow label="HS guess">
          {request.hsCodeGuess
            ? <span className="font-mono">{request.hsCodeGuess}</span>
            : <span className="text-[var(--color-ivory-mute)]">—</span>}
        </DefRow>
        <DefRow label="Certifications">
          {request.certificationRequirements && request.certificationRequirements.length > 0
            ? <span className="font-mono text-[12px]">{request.certificationRequirements.join(' · ')}</span>
            : <span className="text-[var(--color-ivory-mute)]">—</span>}
        </DefRow>
      </dl>
    </section>
  );
}

function PendingPanel({ status }: { status: ImportRequestStatus }) {
  const msg =
    status === 'submitted' ? 'No shortlist or quote yet. Run the orchestrator from the actions above.'
    : status === 'processing' ? 'The orchestrator is generating your shortlist and a landed-cost quote.'
    : status === 'failed' ? 'The orchestrator failed — see the failure panel above, then re-run.'
    : 'The shortlist and quote will appear here.';
  return (
    <section className="border border-[var(--color-navy-line)] p-8 space-y-2">
      <h2 className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
        Landed-cost quote
      </h2>
      <p className="text-[var(--color-ivory-mute)] text-sm">{msg}</p>
    </section>
  );
}

function QuotePanel({ quote, expires }: { quote: LandedQuote; expires?: string | null }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
          Landed-cost quote
        </h2>
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-[var(--color-ivory-mute)]">
          {tierLabel(quote.confidenceTier)}
        </span>
      </div>

      {/* AI-generated prose summary, shown above the structured table */}
      {quote.prose && quote.prose.summary && (
        <div className="border border-[var(--color-ivory-mute)]/30 bg-[var(--color-navy-soft)]/30 p-5 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
              In plain English
            </span>
            <span className="font-serif italic text-[11px] text-[var(--color-ivory-mute)]/80">
              Generated by {quote.prose.model.split('-').slice(0, 2).join(' ')} ·{' '}
              {new Date(quote.prose.generatedAt).toLocaleDateString('en-IE')}
            </span>
          </div>
          {quote.prose.summary.split(/\n{2,}/).map((paragraph, idx) => (
            <p
              key={idx}
              className="font-serif text-[15px] leading-relaxed text-[var(--color-ivory-dim)] whitespace-pre-wrap"
            >
              {paragraph.trim()}
            </p>
          ))}
        </div>
      )}

      <div className="border border-[var(--color-navy-line)]">
        <table className="w-full text-[13.5px]">
          <tbody>
            <tr className="border-b border-[var(--color-navy-line)]">
              <td className="px-4 py-3 text-[var(--color-ivory-mute)]">Cargo value</td>
              <td className="px-4 py-3 text-right font-mono text-[var(--color-ivory)]">{eurFromCents(quote.cargoValueCents)}</td>
            </tr>
            {quote.components.map((c: LandedQuoteComponent, idx: number) => (
              <tr key={idx} className="border-b border-[var(--color-navy-line)]/60 last:border-b-0">
                <td className="px-4 py-3 align-top">
                  <div className="text-[var(--color-ivory-dim)]">{c.label}</div>
                  {c.note && (
                    <div className="font-serif italic text-[11.5px] text-[var(--color-ivory-mute)] mt-0.5">{c.note}</div>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-right font-mono text-[var(--color-ivory)]">{eurFromCents(c.eurCents)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[var(--color-ivory)]/40 bg-[var(--color-navy-soft)]/30">
              <td className="px-4 py-4 font-mono text-[11px] tracking-[0.16em] uppercase text-[var(--color-ivory)]">Total landed</td>
              <td className="px-4 py-4 text-right font-serif text-2xl text-[var(--color-ivory)]">{eurFromCents(quote.totalLandedCents)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {quote.confidenceNotes && quote.confidenceNotes.length > 0 && (
        <div className="text-[12px] font-serif italic text-[var(--color-ivory-mute)] space-y-1">
          {quote.confidenceNotes.map((n: string, i: number) => <p key={i}>· {n}</p>)}
        </div>
      )}

      {expires && (
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-[var(--color-ivory-mute)]">
          Quote valid until {new Date(expires).toLocaleDateString('en-IE')}
        </p>
      )}
    </section>
  );
}

function ShortlistPanel({ shortlist }: { shortlist: FactoryShortlistBlock[] }) {
  const blocks = shortlist.filter((b) => !b._meta);
  const meta = shortlist.find((b) => b._meta)?._meta;
  if (blocks.length === 0) return null;
  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
          Factory shortlist
        </h2>
        <span className="font-serif italic text-[12px] text-[var(--color-ivory-mute)]">
          Awaiting team verification — samples drawn from the OrcaTrade portfolio.
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {blocks.map((b, idx) => (
          <div
            key={idx}
            className="border border-[var(--color-navy-line)] p-5 space-y-3"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] tracking-[0.16em] uppercase text-[var(--color-ivory)]">
                #{b.rank ?? idx + 1} · {b.country}
              </span>
              {b.fobIndex != null && (
                <span className="font-mono text-[11px] text-[var(--color-ivory-mute)]">FOB ×{b.fobIndex.toFixed(2)}</span>
              )}
            </div>
            {b.countryRationale && (
              <p className="text-[var(--color-ivory-dim)] text-[13px] leading-relaxed">{b.countryRationale}</p>
            )}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--color-navy-line)] text-[11px] font-mono text-[var(--color-ivory-mute)]">
              {b.leadTimeWeeks != null && <div>Lead time: <span className="text-[var(--color-ivory-dim)]">~{b.leadTimeWeeks} wk</span></div>}
              {b.qualityRisk && <div>Quality: <span className="text-[var(--color-ivory-dim)]">{b.qualityRisk}</span></div>}
              {b.ipRisk && <div>IP risk: <span className="text-[var(--color-ivory-dim)]">{b.ipRisk}</span></div>}
              <div>Candidates: <span className="text-[var(--color-ivory-dim)]">{b.candidateCount ?? 0}</span></div>
            </div>
            {b.candidates && b.candidates.length > 0 && (
              <ul className="space-y-1 pt-2 border-t border-[var(--color-navy-line)]">
                {b.candidates.slice(0, 4).map((c, ci) => (
                  <li key={ci} className="text-[13px] text-[var(--color-ivory-dim)] flex items-baseline gap-2">
                    <span aria-hidden className="inline-block w-1 h-1 bg-[var(--color-ivory-mute)]/60 mt-1.5" />
                    <span className="flex-1">
                      {c.name || 'Sample supplier'}
                      {c.city && <span className="text-[var(--color-ivory-mute)]"> · {c.city}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {meta && (
        <p className="font-serif italic text-[12px] text-[var(--color-ivory-mute)] pt-2 border-t border-[var(--color-navy-line)]">
          Methodology: {meta.classifier} (v{meta.version?.replace(/^v/, '') || '1.0'}) classified the request with {meta.classifierHits ?? 0} keyword hits; countries evaluated: {meta.countriesEvaluated?.join(', ') || '—'}; supplier source: {meta.sampleSource}.
        </p>
      )}
    </section>
  );
}

function FailurePanel({ state }: { state: { code?: string; reason?: string; occurredAt?: string; recoverable?: boolean } }) {
  return (
    <div className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/10 p-5 space-y-2">
      <p className="font-mono text-[11px] tracking-[0.14em] uppercase text-[var(--color-critical)]">
        Orchestrator failed{state.code ? ` · ${state.code}` : ''}
      </p>
      {state.reason && <p className="text-[var(--color-ivory-dim)] text-[14px]">{state.reason}</p>}
      <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-[var(--color-ivory-mute)]">
        {state.recoverable ? 'Recoverable — re-run the orchestrator above.' : 'Not recoverable — start a new request.'}
      </p>
    </div>
  );
}

function Banner({ tone, children }: { tone: 'positive' | 'neutral'; children: React.ReactNode }) {
  const borderColor = tone === 'positive' ? 'var(--color-positive)' : 'var(--color-ivory-mute)';
  const bg = tone === 'positive' ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)';
  return (
    <div className="p-4 border" style={{ borderColor, background: bg }}>
      <p className="text-[var(--color-ivory-dim)] text-[14px] leading-relaxed">{children}</p>
    </div>
  );
}

function DefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[10px] tracking-[0.14em] uppercase text-[var(--color-ivory-mute)] self-center">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function PrimaryButton({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-ivory)] text-[var(--color-navy)] font-mono text-[11.5px] tracking-[0.12em] uppercase hover:bg-[var(--color-ivory-dim)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, disabled, children }: { onClick: () => void; disabled: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 px-5 py-2.5 border border-[var(--color-navy-line)] text-[var(--color-ivory-dim)] font-mono text-[11.5px] tracking-[0.12em] uppercase hover:text-[var(--color-ivory)] hover:border-[var(--color-ivory-mute)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}
