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
  type ComplianceProbes,
  type ComplianceProbeResult,
  type Shipment,
  type ShipmentStatus,
  SHIPMENT_VALID_TRANSITIONS,
} from '@/lib/api';
import { TransitionHistory } from '@/components/TransitionHistory';

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
  // Sprint 9: gate the LinkedShipmentPanel's transition control on
  // the user's role. Cheap second fetch (same endpoint the Sidebar
  // hits); future polish can lift to a shared context.
  const [isOpsRole, setIsOpsRole] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account/role', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && typeof d.isOpsRole === 'boolean') setIsOpsRole(d.isOpsRole); })
      .catch(() => { /* silent — safe default keeps the control hidden */ });
    return () => { cancelled = true; };
  }, []);

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
    <article className="space-y-14 pb-16">
      {/* Hero header */}
      <header className="relative pt-4">
        <div
          aria-hidden
          className="absolute -top-8 -right-8 w-72 h-72 pointer-events-none rounded-full"
          style={{
            background: 'radial-gradient(closest-side, var(--color-aqua-glow), transparent)',
            filter: 'blur(8px)',
          }}
        />
        <div className="relative space-y-5">
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-ivory-mute)]">
            <Link href="/imports" className="hover:text-[var(--color-aqua)] transition-colors">
              Imports
            </Link>
            <span aria-hidden>›</span>
            <span className="font-mono text-[var(--color-ivory-dim)]">{request.externalId}</span>
          </div>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <h1 className="text-[clamp(2.25rem,4.5vw,3.25rem)] font-bold text-[var(--color-ivory)] tracking-[-0.025em] leading-[1.05] max-w-3xl">
              {request.label}
            </h1>
            <span
              className="inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium border"
              style={{
                color: tone,
                borderColor: tone,
                background: `${tone}10`,
                borderRadius: 'var(--radius-badge)',
              }}
            >
              <span
                aria-hidden
                className="inline-block w-1.5 h-1.5"
                style={{ background: tone, borderRadius: '999px' }}
              />
              {statusLabel(request.status)}
            </span>
          </div>
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

      {/* Linked shipment — sprint 8. Renders only after the customer
          approves and the materialiser spawns the downstream Shipment.
          Loads soft — a missing shipment (race / archived) hides the
          panel rather than erroring. */}
      {request.linkedShipmentExternalId && (
        <LinkedShipmentPanel
          externalId={request.linkedShipmentExternalId}
          isOpsRole={isOpsRole}
        />
      )}

      {/* Audit timeline — sprint 7. Reuses the polymorphic component
          that powers the shipment / goods / supplier detail pages. */}
      <section className="space-y-4">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
          Activity
        </h2>
        <TransitionHistory entityKind="import_request" externalId={request.externalId} />
      </section>

      {/* Audit trail link / footer */}
      <footer className="border-t border-white/[0.06] pt-5 text-[var(--color-ivory-mute)] text-[12.5px] font-serif italic">
        Created {new Date(request.createdAt).toLocaleString('en-IE')} · last updated {new Date(request.updatedAt).toLocaleString('en-IE')}
        {request.linkedShipmentExternalId && (
          <>
            {' '}· materialised as{' '}
            <Link
              href={`/shipments/${request.linkedShipmentExternalId}`}
              className="text-[var(--color-aqua)] hover:underline not-italic font-sans font-medium"
            >
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
    <div
      className="bg-[var(--surface-elevated)] border border-[var(--color-aqua)]/15 p-6 space-y-4"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex flex-wrap gap-3">{buttons}</div>
      {actionError && (
        <p className="text-[13px] font-medium text-[var(--color-critical)]">
          {actionError}
        </p>
      )}
    </div>
  );
}

function IntentPanel({ request }: { request: ImportRequest }) {
  return (
    <section
      className="bg-[var(--surface-card)] border border-white/[0.06] p-7 space-y-5"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
        What you asked for
      </h2>
      <p className="text-[var(--color-ivory)] text-[15.5px] leading-relaxed whitespace-pre-wrap">
        {request.productDescription}
      </p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 pt-5 border-t border-white/[0.06] text-[13.5px]">
        <DefRow label="Route">
          <span className="font-mono text-[var(--color-ivory-dim)]">{request.originCountry || '?'} → {request.destinationCountry}</span>
        </DefRow>
        <DefRow label="Quantity">
          {request.targetQuantity
            ? <span className="font-mono text-[var(--color-ivory-dim)]">{request.targetQuantity.toLocaleString('en-IE')} {request.targetQuantityUnit?.replace(/_/g, ' ')}</span>
            : <span className="text-[var(--color-ivory-mute)]">—</span>}
        </DefRow>
        <DefRow label="Target unit price">
          {request.targetUnitPriceCents != null
            ? <span className="font-mono text-[var(--color-ivory-dim)]">{eurFromCents(request.targetUnitPriceCents)}</span>
            : <span className="text-[var(--color-ivory-mute)]">—</span>}
        </DefRow>
        <DefRow label="Target delivery">
          {request.targetDeliveryDate
            ? <span className="font-mono text-[var(--color-ivory-dim)]">{request.targetDeliveryDate}</span>
            : <span className="text-[var(--color-ivory-mute)]">—</span>}
        </DefRow>
        <DefRow label="HS guess">
          {request.hsCodeGuess
            ? <span className="font-mono text-[var(--color-ivory-dim)]">{request.hsCodeGuess}</span>
            : <span className="text-[var(--color-ivory-mute)]">—</span>}
        </DefRow>
        <DefRow label="Certifications">
          {request.certificationRequirements && request.certificationRequirements.length > 0
            ? <span className="text-[12.5px] text-[var(--color-ivory-dim)]">{request.certificationRequirements.join(' · ')}</span>
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
    <section
      className="bg-[var(--surface-card)] border border-white/[0.06] p-7 space-y-3"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
        Landed-cost quote
      </h2>
      <p className="text-[var(--color-ivory-dim)] text-[14px]">{msg}</p>
    </section>
  );
}

function QuotePanel({ quote, expires }: { quote: LandedQuote; expires?: string | null }) {
  return (
    <section
      className="bg-[var(--surface-card)] border border-white/[0.06] p-7 space-y-6"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
          Landed-cost quote
        </h2>
        <span className="text-[11px] font-medium text-[var(--color-ivory-mute)]">
          {tierLabel(quote.confidenceTier)}
        </span>
      </div>

      {/* AI-generated prose summary, shown above the structured table */}
      {quote.prose && quote.prose.summary && (
        <div
          className="border border-[var(--color-aqua)]/20 bg-[var(--color-aqua-soft)] p-5 space-y-3"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-[10.5px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
              In plain English
            </span>
            <span className="font-serif italic text-[11.5px] text-[var(--color-ivory-mute)]/80">
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

      <div
        className="border border-white/[0.06] overflow-hidden"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        <table className="w-full text-[14px]">
          <tbody>
            <tr className="border-b border-white/[0.06]">
              <td className="px-5 py-3.5 text-[var(--color-ivory-mute)]">Cargo value</td>
              <td className="px-5 py-3.5 text-right font-mono text-[var(--color-ivory)] tabular-nums">{eurFromCents(quote.cargoValueCents)}</td>
            </tr>
            {quote.components.map((c: LandedQuoteComponent, idx: number) => (
              <tr key={idx} className="border-b border-white/[0.04] last:border-b-0">
                <td className="px-5 py-3.5 align-top">
                  <div className="text-[var(--color-ivory-dim)]">{c.label}</div>
                  {c.note && (
                    <div className="font-serif italic text-[12px] text-[var(--color-ivory-mute)] mt-0.5">{c.note}</div>
                  )}
                </td>
                <td className="px-5 py-3.5 align-top text-right font-mono text-[var(--color-ivory)] tabular-nums">{eurFromCents(c.eurCents)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-[var(--color-aqua)]/30 bg-[var(--color-aqua-soft)]">
              <td className="px-5 py-4 text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">Total landed</td>
              <td className="px-5 py-4 text-right text-[28px] font-bold text-[var(--color-ivory)] tracking-[-0.015em] tabular-nums">
                {eurFromCents(quote.totalLandedCents)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {quote.confidenceNotes && quote.confidenceNotes.length > 0 && (
        <div className="text-[12.5px] font-serif italic text-[var(--color-ivory-mute)] space-y-1">
          {quote.confidenceNotes.map((n: string, i: number) => <p key={i}>· {n}</p>)}
        </div>
      )}

      {quote.complianceProbes && (
        <CompliancePanel probes={quote.complianceProbes} />
      )}

      {expires && (
        <p className="text-[11.5px] text-[var(--color-ivory-mute)]">
          Quote valid until <span className="text-[var(--color-ivory-dim)] font-medium">{new Date(expires).toLocaleDateString('en-IE')}</span>
        </p>
      )}
    </section>
  );
}

function regimeTone(applies: ComplianceProbeResult['applies']): string {
  // 'true' → live obligation (warning amber)
  // 'maybe' → verify, but not load-bearing (neutral ivory-mute)
  // 'false' → not in scope (positive green)
  if (applies === true) return 'var(--color-warning)';
  if (applies === 'maybe') return 'var(--color-ivory-mute)';
  return 'var(--color-positive)';
}

function regimeLabel(applies: ComplianceProbeResult['applies']): string {
  if (applies === true) return 'In scope';
  if (applies === 'maybe') return 'Verify';
  return 'Out of scope';
}

function CompliancePanel({ probes }: { probes: ComplianceProbes }) {
  const rows: { regime: string; label: string; probe: ComplianceProbeResult | null }[] = [
    { regime: 'cbam', label: 'CBAM · carbon border adjustment', probe: probes.cbam },
    { regime: 'eudr', label: 'EUDR · deforestation regulation', probe: probes.eudr },
    { regime: 'reach', label: 'REACH · chemicals', probe: probes.reach },
  ];
  return (
    <section className="space-y-4 border-t border-white/[0.06] pt-6">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
          EU compliance · applicability
        </h3>
        <span className="font-serif italic text-[12px] text-[var(--color-ivory-mute)]/80">
          Calculator-grounded probes · {probes.productCategory}
        </span>
      </div>
      <div className="space-y-2.5">
        {rows.map(({ regime, label, probe }) => {
          if (!probe) return null;
          const tone = regimeTone(probe.applies);
          return (
            <div
              key={regime}
              className="border border-white/[0.06] bg-white/[0.015] px-5 py-3.5 grid grid-cols-[auto_1fr_auto] gap-4 items-start"
              style={{ borderRadius: 'var(--radius-card)' }}
            >
              <span
                aria-hidden
                className="inline-block w-2 h-2 mt-1.5"
                style={{ background: tone, borderRadius: '999px' }}
              />
              <div className="space-y-1 min-w-0">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="text-[13px] font-semibold text-[var(--color-ivory)]">
                    {label}
                  </span>
                  <span
                    className="text-[11px] font-medium uppercase tracking-[0.06em]"
                    style={{ color: tone }}
                  >
                    {regimeLabel(probe.applies)}
                  </span>
                </div>
                {probe.reason && (
                  <p className="text-[13px] text-[var(--color-ivory-dim)] leading-snug">
                    {probe.reason}
                  </p>
                )}
                {probe.citation && (
                  <p className="font-serif italic text-[11.5px] text-[var(--color-ivory-mute)]">
                    {probe.citation}
                  </p>
                )}
              </div>
              {probe.confidence && (
                <span
                  className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--color-ivory-mute)] px-2 py-0.5 border border-white/[0.06] bg-white/[0.02]"
                  style={{ borderRadius: 'var(--radius-badge)' }}
                  title="probe confidence — green = high, amber = verify"
                >
                  {probe.confidence}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ShortlistPanel({ shortlist }: { shortlist: FactoryShortlistBlock[] }) {
  const blocks = shortlist.filter((b) => !b._meta);
  const meta = shortlist.find((b) => b._meta)?._meta;
  if (blocks.length === 0) return null;
  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
          Factory shortlist
        </h2>
        <span className="font-serif italic text-[12.5px] text-[var(--color-ivory-mute)]">
          Awaiting team verification — samples drawn from the OrcaTrade portfolio.
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {blocks.map((b, idx) => {
          const isTopPick = (b.rank ?? idx + 1) === 1;
          return (
            <div
              key={idx}
              className={`bg-[var(--surface-card)] p-6 space-y-3 transition-all duration-200 hover:shadow-[var(--shadow-card-hover)] ${
                isTopPick
                  ? 'border border-[var(--color-aqua)]/30 ring-1 ring-[var(--color-aqua)]/20'
                  : 'border border-white/[0.06]'
              }`}
              style={{
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--shadow-card)',
              }}
            >
              <div className="flex items-baseline justify-between">
                <span className={`text-[13px] font-semibold ${isTopPick ? 'text-[var(--color-aqua)]' : 'text-[var(--color-ivory)]'}`}>
                  #{b.rank ?? idx + 1} · {b.country}
                </span>
                {b.fobIndex != null && (
                  <span className="font-mono text-[11.5px] text-[var(--color-ivory-mute)] tabular-nums">FOB ×{b.fobIndex.toFixed(2)}</span>
                )}
              </div>
              {b.countryRationale && (
                <p className="text-[var(--color-ivory-dim)] text-[13px] leading-relaxed">{b.countryRationale}</p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-white/[0.06] text-[11.5px] text-[var(--color-ivory-mute)]">
                {b.leadTimeWeeks != null && <div>Lead time: <span className="text-[var(--color-ivory-dim)]">~{b.leadTimeWeeks} wk</span></div>}
                {b.qualityRisk && <div>Quality: <span className="text-[var(--color-ivory-dim)]">{b.qualityRisk}</span></div>}
                {b.ipRisk && <div>IP risk: <span className="text-[var(--color-ivory-dim)]">{b.ipRisk}</span></div>}
                <div>Candidates: <span className="text-[var(--color-ivory-dim)]">{b.candidateCount ?? 0}</span></div>
              </div>
              {b.candidates && b.candidates.length > 0 && (
                <ul className="space-y-1.5 pt-3 border-t border-white/[0.06]">
                  {b.candidates.slice(0, 4).map((c, ci) => (
                    <li key={ci} className="text-[13px] text-[var(--color-ivory-dim)] flex items-baseline gap-2">
                      <span
                        aria-hidden
                        className="inline-block w-1 h-1 mt-1.5"
                        style={{ background: 'var(--color-aqua)', borderRadius: '999px' }}
                      />
                      <span className="flex-1">
                        {c.name || 'Sample supplier'}
                        {c.city && <span className="text-[var(--color-ivory-mute)]"> · {c.city}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      {meta && (
        <p className="font-serif italic text-[12.5px] text-[var(--color-ivory-mute)] pt-3 border-t border-white/[0.06]">
          Methodology: {meta.classifier} (v{meta.version?.replace(/^v/, '') || '1.0'}) classified the request with {meta.classifierHits ?? 0} keyword hits; countries evaluated: {meta.countriesEvaluated?.join(', ') || '—'}; supplier source: {meta.sampleSource}.
        </p>
      )}
    </section>
  );
}

function FailurePanel({ state }: { state: { code?: string; reason?: string; occurredAt?: string; recoverable?: boolean } }) {
  return (
    <div
      className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/8 p-6 space-y-2"
      style={{ borderRadius: 'var(--radius-card)' }}
    >
      <p className="text-[13px] font-semibold text-[var(--color-critical)]">
        Orchestrator failed{state.code ? ` · ${state.code}` : ''}
      </p>
      {state.reason && <p className="text-[var(--color-ivory-dim)] text-[14px] leading-relaxed">{state.reason}</p>}
      <p className="text-[12px] font-medium text-[var(--color-ivory-mute)]">
        {state.recoverable ? 'Recoverable — re-run the orchestrator above.' : 'Not recoverable — start a new request.'}
      </p>
    </div>
  );
}

// ── Sprint 8: linked-shipment status panel ──────────────────────────
//
// Shipment status tones — match the dot/colour treatment used for the
// import_request status pill in the page hero. planned/booked are
// neutral-warning (waiting on an action); in_transit is warning
// (cargo in motion, requires monitoring); cleared/delivered are
// positive (good progress); exception/cancelled are critical.

function shipmentStatusTone(s: ShipmentStatus): string {
  if (s === 'exception' || s === 'cancelled') return 'var(--color-critical)';
  if (s === 'delivered') return 'var(--color-positive)';
  if (s === 'cleared') return 'var(--color-aqua)';
  if (s === 'in_transit' || s === 'booked') return 'var(--color-warning)';
  return 'var(--color-ivory-mute)';
}

function shipmentStatusLabel(s: ShipmentStatus): string {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function eurFromCentsInline(cents?: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + (Math.round(cents) / 100).toLocaleString('en-IE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

type LinkedShipmentLoadState = 'loading' | 'auth' | 'not-found' | 'error' | 'ready';

function LinkedShipmentPanel({
  externalId,
  isOpsRole = false,
}: {
  externalId: string;
  isOpsRole?: boolean;
}) {
  const [state, setState] = useState<LinkedShipmentLoadState>('loading');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // Sprint 9 ch 1 — ops-only transition control state.
  const [transitionPending, setTransitionPending] = useState<ShipmentStatus | null>(null);
  const [transitionError, setTransitionError] = useState<string>('');

  const fetchShipment = useCallback(() => {
    return apiGet<{ ok: boolean; shipment: Shipment }>(`/shipments/${externalId}`)
      .then((d) => {
        setShipment(d.shipment);
        setState('ready');
        return d.shipment;
      });
  }, [externalId]);

  useEffect(() => {
    let cancelled = false;
    fetchShipment()
      .then(() => { /* state already set */ })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) setState('auth');
        else if (err instanceof Error && /HTTP 404/.test(err.message)) setState('not-found');
        else {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load shipment');
          setState('error');
        }
      });
    return () => { cancelled = true; };
  }, [externalId, fetchShipment]);

  async function transitionTo(toStatus: ShipmentStatus) {
    setTransitionPending(toStatus);
    setTransitionError('');
    try {
      await apiPost(`/shipments/${externalId}/transition`, { toStatus });
      await fetchShipment();
    } catch (err) {
      if (err instanceof ApiError) {
        setTransitionError(err.errors.length ? err.errors.join('; ') : err.message);
      } else {
        setTransitionError(err instanceof Error ? err.message : 'Transition failed');
      }
    } finally {
      setTransitionPending(null);
    }
  }

  // The not-found branch hides the panel entirely. After approval
  // there's a brief window where the customer's detail page polls
  // before the materialiser has fully linked + indexed the shipment;
  // rather than flash a "not found" message we just hide and let the
  // next render catch the row.
  if (state === 'auth' || state === 'not-found') return null;

  return (
    <section
      className="bg-[var(--surface-card)] border border-white/[0.06] p-7 space-y-5"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
          Your shipment
        </h2>
        <Link
          href={`/shipments/${externalId}`}
          className="text-[12.5px] text-[var(--color-aqua)] hover:underline font-medium"
        >
          Open full timeline →
        </Link>
      </div>

      {state === 'loading' && (
        <p className="text-[var(--color-ivory-mute)] text-sm">Loading shipment…</p>
      )}
      {state === 'error' && (
        <p className="text-[13px] text-[var(--color-critical)]">{errorMsg}</p>
      )}
      {state === 'ready' && shipment && (
        <div className="space-y-5">
          {/* Status + label */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1 min-w-0">
              <div className="font-mono text-[11.5px] tracking-[0.05em] text-[var(--color-ivory-mute)]">
                {shipment.externalId}
              </div>
              <div className="text-[18px] font-semibold text-[var(--color-ivory)] tracking-[-0.01em] truncate">
                {shipment.label}
              </div>
            </div>
            <span
              className="inline-flex items-center gap-2 px-3 py-1.5 text-[12px] font-medium border"
              style={{
                color: shipmentStatusTone(shipment.status),
                borderColor: shipmentStatusTone(shipment.status),
                background: `${shipmentStatusTone(shipment.status)}10`,
                borderRadius: 'var(--radius-badge)',
              }}
            >
              <span
                aria-hidden
                className="inline-block w-1.5 h-1.5"
                style={{ background: shipmentStatusTone(shipment.status), borderRadius: '999px' }}
              />
              {shipmentStatusLabel(shipment.status)}
            </span>
          </div>

          {/* Operational facts */}
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 pt-4 border-t border-white/[0.06] text-[13.5px]">
            <DefRow label="Route">
              <span className="font-mono text-[var(--color-ivory-dim)]">
                {shipment.originCountry || '?'} → {shipment.destinationCountry || '?'}
              </span>
            </DefRow>
            <DefRow label="Cargo value">
              <span className="font-mono text-[var(--color-ivory-dim)] tabular-nums">
                {eurFromCentsInline(shipment.customsValueCents)}
              </span>
            </DefRow>
            {shipment.plannedDepartureDate && (
              <DefRow label="Plan · departs">
                <span className="font-mono text-[var(--color-ivory-dim)]">{shipment.plannedDepartureDate}</span>
              </DefRow>
            )}
            {shipment.plannedArrivalDate && (
              <DefRow label="Plan · arrives">
                <span className="font-mono text-[var(--color-ivory-dim)]">{shipment.plannedArrivalDate}</span>
              </DefRow>
            )}
            {shipment.carrier && (
              <DefRow label="Carrier">
                <span className="text-[var(--color-ivory-dim)]">{shipment.carrier}</span>
              </DefRow>
            )}
            {shipment.bookingRef && (
              <DefRow label="Booking">
                <span className="font-mono text-[var(--color-ivory-dim)]">{shipment.bookingRef}</span>
              </DefRow>
            )}
            {shipment.blNumber && (
              <DefRow label="B/L">
                <span className="font-mono text-[var(--color-ivory-dim)]">{shipment.blNumber}</span>
              </DefRow>
            )}
            {shipment.eta && (
              <DefRow label="ETA">
                <span className="font-mono text-[var(--color-aqua)]">{shipment.eta}</span>
              </DefRow>
            )}
            {shipment.lastKnownLocation && (
              <DefRow label="Last seen">
                <span className="text-[var(--color-ivory-dim)]">{shipment.lastKnownLocation}</span>
              </DefRow>
            )}
            {shipment.dutyPaidCents != null && (
              <DefRow label="Duty paid">
                <span className="font-mono text-[var(--color-ivory-dim)] tabular-nums">{eurFromCentsInline(shipment.dutyPaidCents)}</span>
              </DefRow>
            )}
            {shipment.vatPaidCents != null && (
              <DefRow label="VAT paid">
                <span className="font-mono text-[var(--color-ivory-dim)] tabular-nums">{eurFromCentsInline(shipment.vatPaidCents)}</span>
              </DefRow>
            )}
            {shipment.deliveredAt && (
              <DefRow label="Delivered">
                <span className="font-mono text-[var(--color-positive)]">
                  {new Date(shipment.deliveredAt).toLocaleDateString('en-IE')}
                </span>
              </DefRow>
            )}
          </dl>

          {/* Exception banner (loud, but inline so the rest of the
              card still reads). Only renders when exception_state has
              been written. */}
          {shipment.status === 'exception' && shipment.exceptionState && shipment.exceptionState.reason && (
            <div
              className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/8 p-4"
              style={{ borderRadius: 'var(--radius-card)' }}
            >
              <p className="text-[12px] font-semibold text-[var(--color-critical)]">Exception</p>
              <p className="text-[13.5px] text-[var(--color-ivory-dim)] mt-1">
                {String(shipment.exceptionState.reason)}
              </p>
            </div>
          )}

          {/* Ops-only transition control — sprint 9 ch 1. Hidden for
              customers; gated client-side via isOpsRole + server-side
              by the shipments handler's auth gate. */}
          {isOpsRole && (
            <ShipmentTransitionControl
              shipment={shipment}
              transitionPending={transitionPending}
              transitionError={transitionError}
              onTransition={transitionTo}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ShipmentTransitionControl({
  shipment,
  transitionPending,
  transitionError,
  onTransition,
}: {
  shipment: Shipment;
  transitionPending: ShipmentStatus | null;
  transitionError: string;
  onTransition: (toStatus: ShipmentStatus) => void;
}) {
  const legalNext = SHIPMENT_VALID_TRANSITIONS[shipment.status] || [];
  if (legalNext.length === 0) {
    // Terminal state (cancelled). Show nothing — no transitions
    // available — rather than a dead-end empty button row.
    return null;
  }

  // Happy-path destination is the first non-exception, non-cancelled
  // next state for the current row. Highlighted as the primary CTA;
  // the other legal edges render as smaller secondary buttons.
  const happyPath = legalNext.find((s) => s !== 'exception' && s !== 'cancelled') || null;
  const secondary = legalNext.filter((s) => s !== happyPath);

  return (
    <div className="pt-5 border-t border-white/[0.06] space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
          Advance status · ops
        </span>
        <span className="font-serif italic text-[11.5px] text-[var(--color-ivory-mute)]/80">
          Customer is notified by email on every transition.
        </span>
      </div>
      <div className="flex flex-wrap gap-2.5 items-center">
        {happyPath && (
          <button
            type="button"
            onClick={() => onTransition(happyPath)}
            disabled={transitionPending !== null}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[13px] font-semibold transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
            style={{
              borderRadius: 'var(--radius-button)',
              boxShadow: transitionPending ? 'none' : 'var(--shadow-cta)',
            }}
          >
            {transitionPending === happyPath ? 'Advancing…' : `Mark as ${shipmentStatusLabel(happyPath).toLowerCase()} →`}
          </button>
        )}
        {secondary.map((s) => {
          const isCritical = s === 'exception' || s === 'cancelled';
          return (
            <button
              key={s}
              type="button"
              onClick={() => onTransition(s)}
              disabled={transitionPending !== null}
              className={`inline-flex items-center gap-1.5 px-4 py-2 border text-[12.5px] font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                isCritical
                  ? 'border-[var(--color-critical)]/40 text-[var(--color-critical)] hover:border-[var(--color-critical)] hover:bg-[var(--color-critical)]/8'
                  : 'border-white/[0.12] text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] hover:border-white/[0.25] hover:bg-white/[0.025]'
              }`}
              style={{ borderRadius: 'var(--radius-button)' }}
            >
              {transitionPending === s ? 'Working…' : shipmentStatusLabel(s)}
            </button>
          );
        })}
      </div>
      {transitionError && (
        <p className="text-[12.5px] font-medium text-[var(--color-critical)]">{transitionError}</p>
      )}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'positive' | 'neutral'; children: React.ReactNode }) {
  const borderColor = tone === 'positive' ? 'var(--color-positive)' : 'var(--color-aqua)';
  const bg = tone === 'positive' ? 'rgba(16,185,129,0.08)' : 'var(--color-aqua-soft)';
  return (
    <div
      className="p-5 border"
      style={{ borderColor: `${borderColor}30`, background: bg, borderRadius: 'var(--radius-card)' }}
    >
      <p className="text-[var(--color-ivory-dim)] text-[14px] leading-relaxed">{children}</p>
    </div>
  );
}

function DefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ivory-mute)] self-center">{label}</dt>
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
      className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[14px] font-semibold transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
      style={{
        borderRadius: 'var(--radius-button)',
        boxShadow: disabled ? 'none' : 'var(--shadow-cta)',
      }}
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
      className="inline-flex items-center gap-2 px-6 py-3 border border-white/[0.12] text-[var(--color-ivory-dim)] text-[14px] font-medium transition-all duration-200 hover:text-[var(--color-ivory)] hover:border-white/[0.25] hover:bg-white/[0.025] disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ borderRadius: 'var(--radius-button)' }}
    >
      {children}
    </button>
  );
}
