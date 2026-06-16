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
  type WhatIfResponse,
  type WhatIfDelta,
  type DeclineReason,
  DECLINE_REASONS,
  DECLINE_REASON_LABELS,
  REVISABLE_DECLINE_REASONS,
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

      {/* Sprint 16 — declined-with-reason panel. Renders only when
          status='cancelled' AND teamReviewState carries a structured
          decline reason. Surfaces the reason + ops note + Revise CTA
          for revisable reasons. */}
      {request.status === 'cancelled' && request.teamReviewState?.declineReason && (
        <DeclinedReasonPanel request={request} />
      )}

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
        // Sprint 16 — structured-decline action. Ops picks one of the
        // DECLINE_REASONS values + an optional free-text note; the
        // data-layer validates the reason, sets revisable on the
        // payload, and the customer receives a templated email with
        // the right CTA.
        onTeamDecline={(reason, notes) =>
          act('team-declining', async () => {
            await apiPost(`/imports/${request.externalId}/review`, {
              decision: 'rejected',
              declineReason: reason,
              notes,
            });
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

      {/* What-if sensitivity — sprint 10. Shows once a baseline
          landed quote exists. Stateless preview against the
          calculator path; the persisted request never changes. */}
      {request.landedQuote && (
        <WhatIfPanel
          externalId={request.externalId}
          baselineLandedQuote={request.landedQuote}
          baselineRequest={request}
        />
      )}

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

      {/* Shareable artifacts — sprint 12 (dossier) + sprint 15 (quote).
          Both render only when a baseline landed quote exists. The
          quote is the customer-facing artifact (hand to your CFO);
          the dossier is the broker-facing one (hand to your filing
          agent). Side-by-side so the customer doesn't conflate them. */}
      {request.landedQuote && (
        <section className="grid gap-4 md:grid-cols-2">
          {/* Sprint 15 — landed-cost quote PDF. The customer's CFO
              asks "where's the quote I can show my finance team" —
              this is the answer. Direct browser download via <a>
              download; endpoint sets Content-Disposition: attachment. */}
          <div
            className="bg-[var(--surface-card)] border border-white/[0.06] p-6 flex flex-col"
            style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
          >
            <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)] mb-2">
              Share with your CFO
            </h2>
            <p className="text-[14px] text-[var(--color-ivory-dim)] leading-relaxed mb-4 flex-1">
              A one-page landed-cost quote: route, breakdown (cargo + freight + duty + VAT + our fee), confidence tier, supplier shortlist preview, validity window.
            </p>
            <a
              href={`/api/imports/${request.externalId}/quote`}
              download={`orcatrade-quote-${request.externalId}.pdf`}
              className="group inline-flex items-center gap-2 self-start px-5 py-3 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[13.5px] font-semibold transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px whitespace-nowrap"
              style={{
                borderRadius: 'var(--radius-button)',
                boxShadow: 'var(--shadow-cta)',
              }}
            >
              Download quote (PDF)
              <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">↓</span>
            </a>
          </div>

          {/* Sprint 12 ch 2b — broker-facing compliance dossier. */}
          <div
            className="bg-[var(--surface-card)] border border-white/[0.06] p-6 flex flex-col"
            style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
          >
            <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)] mb-2">
              Hand to your broker
            </h2>
            <p className="text-[14px] text-[var(--color-ivory-dim)] leading-relaxed mb-4 flex-1">
              Calculator-grounded compliance dossier: HS classification, CBAM/EUDR/REACH applicability with regulation citations, landed-cost breakdown, disclaimers.
            </p>
            <a
              href={`/api/imports/${request.externalId}/dossier`}
              download={`orcatrade-compliance-${request.externalId}.pdf`}
              className="group inline-flex items-center gap-2 self-start px-5 py-3 border border-[var(--color-aqua)] text-[var(--color-aqua)] text-[13.5px] font-semibold transition-all duration-200 hover:bg-[var(--color-aqua)] hover:text-[var(--color-navy)] hover:-translate-y-px whitespace-nowrap"
              style={{ borderRadius: 'var(--radius-button)' }}
            >
              Download dossier (PDF)
              <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">↓</span>
            </a>
          </div>
        </section>
      )}

      {/* Audit trail link / footer */}
      <footer className="border-t border-white/[0.06] pt-5 flex items-baseline justify-between gap-4 flex-wrap text-[var(--color-ivory-mute)] text-[12.5px]">
        <div className="font-serif italic">
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
          {/* Sprint 16 — revision lineage. Surface the back-pointer to
              the request this row was revised FROM so the customer +
              ops can navigate the chain. */}
          {request.revisedFromExternalId && (
            <>
              {' '}· revised from{' '}
              <Link
                href={`/imports/${request.revisedFromExternalId}`}
                className="text-[var(--color-aqua)] hover:underline not-italic font-sans font-medium font-mono"
              >
                {request.revisedFromExternalId}
              </Link>
            </>
          )}
        </div>
        {/* Sprint 13 ch 2 — duplicate this request. Common workflow for
            repeat orders: same product, same factory, different
            quantity. Pre-fills /imports/new from query param. */}
        <Link
          href={`/imports/new?duplicate=${encodeURIComponent(request.externalId)}`}
          className="inline-flex items-center gap-1.5 text-[var(--color-aqua)] hover:underline not-italic font-sans font-medium text-[12.5px]"
        >
          Duplicate this request →
        </Link>
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
  onTeamDecline,
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
  onTeamDecline: (reason: DeclineReason, notes: string) => void;
}) {
  const s = request.status;
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState<DeclineReason>('price_target_unrealistic');
  const [declineNotes, setDeclineNotes] = useState('');

  if (s === 'customer_approved') {
    return (
      <Banner tone="positive">
        Approved. Our team has picked it up — you will get an email when the factory PO is acknowledged.
      </Banner>
    );
  }
  // Sprint 16 — when the team declined with a structured reason, the
  // customer sees a richer panel (DeclinedReasonPanel) rendered above.
  // The plain "closed" banner stays for the other terminal states.
  if (s === 'customer_rejected' || s === 'expired') {
    return (
      <Banner tone="neutral">
        This request is closed. Start a <Link href="/imports/new" className="underline">new request</Link> if you want to revise inputs and try again.
      </Banner>
    );
  }
  if (s === 'cancelled' && !request.teamReviewState?.declineReason) {
    return (
      <Banner tone="neutral">
        This request is closed. Start a <Link href="/imports/new" className="underline">new request</Link> if you want to revise inputs and try again.
      </Banner>
    );
  }
  if (s === 'cancelled' && request.teamReviewState?.declineReason) {
    // The DeclinedReasonPanel rendered above already gives the user
    // the right next-step CTA; suppress the action zone.
    return null;
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
      // Sprint 16 — structured decline. Opens an inline reason picker.
      <SecondaryButton
        key="team-decline"
        onClick={() => setDeclineOpen((v) => !v)}
        disabled={!!actionPending}
      >
        {declineOpen ? 'Cancel decline' : 'Decline with reason'}
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
      {/* Sprint 16 — inline decline-with-reason form. Renders only
          when ops clicks "Decline with reason" on an awaiting_review
          request. Reason picker is a constrained select bound to
          DECLINE_REASONS so the data-layer never sees an unknown
          enum value. */}
      {declineOpen && s === 'awaiting_review' && (
        <div
          className="border-t border-white/[0.08] pt-4 mt-2 space-y-4"
        >
          <div>
            <label className="block text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ivory-mute)] mb-2">
              Reason
            </label>
            <select
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value as DeclineReason)}
              className="w-full bg-[var(--surface-card)] border border-white/10 text-[var(--color-ivory)] text-[14px] px-3 py-2 rounded focus:border-[var(--color-aqua)] focus:outline-none"
            >
              {DECLINE_REASONS.map((r) => (
                <option key={r} value={r}>{DECLINE_REASON_LABELS[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ivory-mute)] mb-2">
              Note for the customer (optional)
            </label>
            <textarea
              value={declineNotes}
              onChange={(e) => setDeclineNotes(e.target.value.slice(0, 4000))}
              placeholder="Tell the customer what specifically to change. Shown in the rejection email."
              rows={3}
              className="w-full bg-[var(--surface-card)] border border-white/10 text-[var(--color-ivory)] text-[13.5px] px-3 py-2 rounded focus:border-[var(--color-aqua)] focus:outline-none resize-y"
            />
            <p className="text-[11px] text-[var(--color-ivory-mute)] mt-1">{declineNotes.length} / 4000</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <PrimaryButton
              onClick={() => {
                onTeamDecline(declineReason, declineNotes);
                setDeclineOpen(false);
                setDeclineNotes('');
              }}
              disabled={!!actionPending}
            >
              {actionPending === 'team-declining' ? 'Declining…' : 'Send decline + email customer'}
            </PrimaryButton>
            <SecondaryButton
              onClick={() => { setDeclineOpen(false); setDeclineNotes(''); }}
              disabled={!!actionPending}
            >
              Cancel
            </SecondaryButton>
          </div>
        </div>
      )}
      {actionError && (
        <p className="text-[13px] font-medium text-[var(--color-critical)]">
          {actionError}
        </p>
      )}
    </div>
  );
}

// Sprint 16 — customer-facing decline panel. Renders when a request
// status='cancelled' AND teamReviewState carries a structured decline
// reason. Surfaces the reason headline + the ops note + a "Revise this
// request" CTA for revisable reasons. The plain "closed" Banner stays
// for non-structured cancellations (customer-initiated cancel, expired
// quote, etc).
function DeclinedReasonPanel({ request }: { request: ImportRequest }) {
  const trs = request.teamReviewState;
  if (!trs || !trs.declineReason) return null;
  const reason = trs.declineReason;
  const label = DECLINE_REASON_LABELS[reason] || 'Other';
  const isRevisable = REVISABLE_DECLINE_REASONS.includes(reason);
  return (
    <section
      className="bg-[var(--surface-card)] border border-[var(--color-warning)]/35 p-6 space-y-4"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-warning)]">
          Declined · revise to try again
        </h2>
        <span
          className="text-[10px] font-semibold tracking-[0.06em] uppercase px-2 py-0.5 border border-[var(--color-warning)] text-[var(--color-warning)]"
          style={{ borderRadius: 'var(--radius-badge)', background: 'rgba(245,158,11,0.08)' }}
        >
          {label}
        </span>
      </div>
      {trs.notes && (
        <div>
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ivory-mute)] mb-1.5">
            Team note
          </p>
          <p className="text-[14.5px] text-[var(--color-ivory)] leading-relaxed whitespace-pre-wrap">
            {trs.notes}
          </p>
        </div>
      )}
      {isRevisable && (
        <div className="pt-2">
          <Link
            href={`/imports/new?revise=${encodeURIComponent(request.externalId)}`}
            className="group inline-flex items-center gap-2 px-5 py-3 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[13.5px] font-semibold transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px"
            style={{ borderRadius: 'var(--radius-button)', boxShadow: 'var(--shadow-cta)' }}
          >
            Revise this request
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
          <p className="text-[12.5px] text-[var(--color-ivory-mute)] mt-3 leading-relaxed max-w-xl">
            Your intent will be pre-filled on the revision form — just adjust the line that needs to change. We will re-quote.
          </p>
        </div>
      )}
    </section>
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

// ── Sprint 10: what-if sensitivity panel ────────────────────────────
//
// Stateless preview against the calculator path — customer tweaks
// inputs, sees a fresh landed-cost total + delta vs baseline, original
// request stays untouched. Sprint 10 is the first product moment where
// the customer can play with the quote without resubmitting.

const ASIA_ORIGIN_OPTIONS = [
  { code: 'CN', name: 'China' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'IN', name: 'India' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'MY', name: 'Malaysia' },
];

function eurBigFromCents(cents?: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + Math.round(cents / 100).toLocaleString('en-IE');
}

function eurSignedFromCents(cents: number): string {
  const sign = cents >= 0 ? '+' : '−';
  return sign + '€' + Math.abs(Math.round(cents / 100)).toLocaleString('en-IE');
}

function pctSigned(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '';
  const sign = pct >= 0 ? '+' : '−';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

type WhatIfFormState = {
  targetQuantity: string;
  targetUnitPriceEur: string;
  originCountry: string;
  hsCodeGuess: string;
};

function WhatIfPanel({
  externalId,
  baselineLandedQuote,
  baselineRequest,
}: {
  externalId: string;
  baselineLandedQuote: LandedQuote;
  baselineRequest: ImportRequest;
}) {
  const [form, setForm] = useState<WhatIfFormState>({
    targetQuantity: baselineRequest.targetQuantity ? String(baselineRequest.targetQuantity) : '',
    targetUnitPriceEur: baselineRequest.targetUnitPriceCents
      ? (baselineRequest.targetUnitPriceCents / 100).toFixed(2)
      : '',
    originCountry: baselineRequest.originCountry || 'CN',
    hsCodeGuess: baselineRequest.hsCodeGuess || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  function update<K extends keyof WhatIfFormState>(key: K, value: WhatIfFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function recalculate(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg('');
    try {
      const payload: Record<string, unknown> = {};
      if (form.targetQuantity) payload.targetQuantity = Math.round(Number(form.targetQuantity));
      if (form.targetUnitPriceEur) payload.targetUnitPriceCents = Math.round(Number(form.targetUnitPriceEur) * 100);
      if (form.originCountry) payload.originCountry = form.originCountry;
      if (form.hsCodeGuess) payload.hsCodeGuess = form.hsCodeGuess;
      const data = await apiPost<WhatIfResponse>(`/imports/${externalId}/whatif`, payload);
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg(err.errors.length ? err.errors.join('; ') : err.message);
      } else if (err instanceof AuthError) {
        setErrorMsg('Please sign in.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Recalculation failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetToBaseline() {
    setForm({
      targetQuantity: baselineRequest.targetQuantity ? String(baselineRequest.targetQuantity) : '',
      targetUnitPriceEur: baselineRequest.targetUnitPriceCents
        ? (baselineRequest.targetUnitPriceCents / 100).toFixed(2)
        : '',
      originCountry: baselineRequest.originCountry || 'CN',
      hsCodeGuess: baselineRequest.hsCodeGuess || '',
    });
    setResult(null);
    setErrorMsg('');
  }

  return (
    <section
      className="bg-[var(--surface-card)] border border-[var(--color-aqua)]/15 p-7 space-y-6"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
            Try a different scenario
          </h2>
          <p className="font-serif italic text-[12.5px] text-[var(--color-ivory-mute)] mt-1">
            Tweak any input. The original quote stays unchanged — this is a preview.
          </p>
        </div>
        {result && (
          <button
            type="button"
            onClick={resetToBaseline}
            className="text-[12.5px] text-[var(--color-aqua)] hover:underline font-medium"
          >
            Reset to baseline
          </button>
        )}
      </div>

      <form onSubmit={recalculate} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <WhatIfField label="Quantity">
            <input
              type="number"
              min={1}
              value={form.targetQuantity}
              onChange={(e) => update('targetQuantity', e.target.value)}
              className="whatif-input"
              placeholder={baselineRequest.targetQuantity ? String(baselineRequest.targetQuantity) : '3000'}
            />
          </WhatIfField>
          <WhatIfField label="Target landed unit price (EUR)">
            <input
              type="number"
              step="0.01"
              min={0}
              value={form.targetUnitPriceEur}
              onChange={(e) => update('targetUnitPriceEur', e.target.value)}
              className="whatif-input"
              placeholder={baselineRequest.targetUnitPriceCents
                ? (baselineRequest.targetUnitPriceCents / 100).toFixed(2)
                : '13.00'}
            />
          </WhatIfField>
          <WhatIfField label="Origin">
            <select
              value={form.originCountry}
              onChange={(e) => update('originCountry', e.target.value)}
              className="whatif-input"
            >
              {ASIA_ORIGIN_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
              ))}
            </select>
          </WhatIfField>
          <WhatIfField label="HS code (6-10 digits)">
            <input
              type="text"
              value={form.hsCodeGuess}
              onChange={(e) => update('hsCodeGuess', e.target.value.replace(/[^0-9]/g, ''))}
              maxLength={10}
              className="whatif-input font-mono"
              placeholder={baselineRequest.hsCodeGuess || '392410'}
            />
          </WhatIfField>
        </div>

        {errorMsg && (
          <p className="text-[12.5px] text-[var(--color-critical)] font-medium">{errorMsg}</p>
        )}

        <div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[14px] font-semibold transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0"
            style={{
              borderRadius: 'var(--radius-button)',
              boxShadow: submitting ? 'none' : 'var(--shadow-cta)',
            }}
          >
            {submitting ? 'Recalculating…' : 'Recalculate landed cost →'}
          </button>
        </div>
      </form>

      {result && result.whatIfQuote && (
        <WhatIfResult
          result={result}
          baselineLandedQuote={baselineLandedQuote}
        />
      )}

      <style jsx>{`
        :global(.whatif-input) {
          width: 100%;
          padding: 0.6rem 0.875rem;
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: var(--radius-input);
          color: var(--color-ivory);
          font-size: 14px;
          line-height: 1.4;
          transition: border-color 200ms ease, background 200ms ease, box-shadow 200ms ease;
        }
        :global(.whatif-input:hover) {
          border-color: rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.04);
        }
        :global(.whatif-input:focus) {
          outline: none;
          border-color: var(--color-aqua);
          background: rgba(255, 255, 255, 0.04);
          box-shadow: 0 0 0 4px var(--color-aqua-soft);
        }
        :global(.whatif-input::placeholder) {
          color: rgba(255, 255, 255, 0.3);
        }
        :global(select.whatif-input) {
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='rgba(255,255,255,0.5)' d='M6 8.5L1.5 4l1-1L6 6.5 9.5 3l1 1z'/></svg>");
          background-repeat: no-repeat;
          background-position: right 0.875rem center;
          padding-right: 2.25rem;
        }
      `}</style>
    </section>
  );
}

function WhatIfField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[12.5px] font-medium text-[var(--color-ivory-dim)]">{label}</span>
      {children}
    </label>
  );
}

function WhatIfResult({
  result,
  baselineLandedQuote,
}: {
  result: WhatIfResponse;
  baselineLandedQuote: LandedQuote;
}) {
  const whatIf = result.whatIfQuote;
  const delta = result.delta;
  const cheaper = delta && delta.totalLandedCents.deltaCents < 0;

  return (
    <div
      className="border border-[var(--color-aqua)]/30 bg-[var(--color-aqua-soft)] p-6 space-y-4"
      style={{ borderRadius: 'var(--radius-card)' }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
          Hypothetical landed cost
        </span>
        <span className="font-mono text-[10.5px] tracking-[0.04em] text-[var(--color-ivory-mute)]">
          HS {result.appliedInputs.hsCode} · {result.appliedInputs.hsSource.replace(/_/g, ' ')}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-6 flex-wrap">
        <div className="space-y-1">
          <div className="text-[34px] font-bold text-[var(--color-ivory)] tracking-[-0.02em] tabular-nums">
            {eurBigFromCents(whatIf.totalLandedCents)}
          </div>
          {delta && (
            <div className="text-[13px] text-[var(--color-ivory-dim)]">
              vs <span className="font-mono">{eurBigFromCents(baselineLandedQuote.totalLandedCents)}</span> baseline ·{' '}
              <span
                className="font-semibold"
                style={{ color: cheaper ? 'var(--color-positive)' : 'var(--color-warning)' }}
              >
                {eurSignedFromCents(delta.totalLandedCents.deltaCents)} ({pctSigned(delta.totalLandedCents.deltaPct)})
              </span>
            </div>
          )}
        </div>
        <span
          className="inline-flex items-center px-3 py-1 text-[11px] font-medium border"
          style={{
            color: 'var(--color-aqua)',
            borderColor: 'var(--color-aqua)',
            background: 'rgba(34,211,238,0.06)',
            borderRadius: 'var(--radius-badge)',
          }}
        >
          Tier {whatIf.confidenceTier}
        </span>
      </div>

      {/* Compact components table */}
      <div
        className="border border-white/[0.06] overflow-hidden"
        style={{ borderRadius: 'var(--radius-card)' }}
      >
        <table className="w-full text-[13px]">
          <tbody>
            <tr className="border-b border-white/[0.06]">
              <td className="px-4 py-2.5 text-[var(--color-ivory-mute)]">Cargo value</td>
              <td className="px-4 py-2.5 text-right font-mono text-[var(--color-ivory)] tabular-nums">{eurBigFromCents(whatIf.cargoValueCents)}</td>
            </tr>
            {whatIf.components.map((c, idx) => (
              <tr key={idx} className="border-b border-white/[0.04] last:border-b-0">
                <td className="px-4 py-2.5 text-[var(--color-ivory-dim)]">{c.label}</td>
                <td className="px-4 py-2.5 text-right font-mono text-[var(--color-ivory)] tabular-nums">{eurBigFromCents(c.eurCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {whatIf.confidenceNotes && whatIf.confidenceNotes.length > 0 && (
        <div className="text-[12px] font-serif italic text-[var(--color-ivory-mute)] space-y-1">
          {whatIf.confidenceNotes.map((n, i) => <p key={i}>· {n}</p>)}
        </div>
      )}
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
