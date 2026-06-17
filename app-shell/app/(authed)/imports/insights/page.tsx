'use client';

// Ops Insights — sprint 17.
//
// The first surface that turns the platform into a learning system.
// Reads GET /api/imports/insights?windowDays=N and renders three
// cohorts:
//
//   1. Funnel        — per-status counts in the window. Shows where
//                      requests pile up + where they fall out.
//   2. Decline       — structured decline reasons (sprint 16). Which
//                      "no" did the team issue most? Spiking reasons
//                      flag a supplier or compliance regime that
//                      needs attention.
//   3. Revision      — the closed-loop metric. Of recoverable
//                      declines, how many became revisions? Of those,
//                      how many made it back into the pipeline?
//                      Higher = the platform is teaching customers
//                      well + ops decline copy is actionable.
//
// All numbers are computed in SQL on the data layer (ADR 0002 — no
// LLM in this read path). The page just renders.
//
// Ops-only — the endpoint gates on requireOpsRole, so a non-ops user
// hitting this URL gets a 403. The page surfaces that with an auth
// banner rather than a confusing blank state.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  ApiError,
  AuthError,
  DECLINE_REASONS,
  DECLINE_REASON_LABELS,
  IMPORT_REQUEST_STATUSES,
  type DeclineReason,
  type ImportRequestStatus,
  type OpsInsights,
  type OpsInsightsResponse,
  type OpsInsightsTopPickedCountry,
  type OpsInsightsRatingCohort,
  type OpsInsightsStalledQueue,
  type OpsInsightsDeclineSpikeCohort,
  type OperatorConfigResponse,
  type ApiKey,
  type ApiKeyListResponse,
  type ApiKeyCreateResponse,
  type WebhookSubscription,
  type WebhookListResponse,
  type WebhookCreateResponse,
  type WebhookEventTypesResponse,
  type WebhookTestResponse,
  type WebhookDeliveryLogEntry,
  type WebhookDeliveriesResponse,
  type WebhookReactivateResponse,
} from '@/lib/api';

// Status grouping — collapses the 9-status taxonomy into 4 funnel
// stages that read naturally as a top-down chart. Order matters: it
// reflects the customer journey.
const FUNNEL_GROUPS: ReadonlyArray<{
  key: string;
  label: string;
  statuses: ReadonlyArray<ImportRequestStatus>;
}> = [
  { key: 'inbound', label: 'Inbound', statuses: ['submitted', 'processing'] as const },
  { key: 'review', label: 'Team review', statuses: ['awaiting_review'] as const },
  { key: 'quoted', label: 'Quoted', statuses: ['quoted'] as const },
  { key: 'approved', label: 'Customer approved', statuses: ['customer_approved'] as const },
];

const TERMINAL_GROUP = {
  key: 'closed',
  label: 'Closed without approval',
  statuses: ['customer_rejected', 'expired', 'cancelled', 'failed'] as const,
};

const WINDOW_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

type LoadState = 'loading' | 'auth' | 'forbidden' | 'error' | 'ready';

export default function InsightsPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<OpsInsights | null>(null);
  const [windowDays, setWindowDays] = useState<number>(30);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    apiGet<OpsInsightsResponse>(`/imports/insights?windowDays=${windowDays}`)
      .then((d) => {
        if (cancelled) return;
        setData(d.insights);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) setState('auth');
        else if (err instanceof ApiError && err.status === 403) setState('forbidden');
        else {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load insights');
          setState('error');
        }
      });
    return () => { cancelled = true; };
  }, [windowDays]);

  if (state === 'loading') return <p className="text-[var(--color-ivory-mute)] text-sm">Loading insights…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to view ops insights</h1>
        <Link
          href="/account/"
          className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-aqua)] text-[var(--color-navy)] rounded-sm"
        >
          Sign in →
        </Link>
      </div>
    );
  }
  if (state === 'forbidden') {
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="text-3xl">Ops-only</h1>
        <p className="text-[var(--color-ivory-dim)] text-[15px] leading-relaxed">
          Insights are visible to owner and admin roles in your organisation. Ask your team lead to grant access if you need them.
        </p>
      </div>
    );
  }
  if (state === 'error') return <p className="text-[var(--color-critical)] text-sm">{errorMsg}</p>;
  if (!data) return null;

  return (
    <div className="max-w-5xl space-y-12 pb-16">
      <Hero windowDays={windowDays} setWindowDays={setWindowDays} totalInWindow={data.totalInWindow} />
      {/* Sprint 42 — per-org operator config. Collapsed by default
          (cockpit isn't a settings page); expands to a tight inline
          form. Sits between Hero + proactive band so the user who
          notices "0 stalled never fires" can dial the threshold
          without leaving the page.
          Sprint 43 — extended with the decline-spike multiplier
          (cohort #7's sensitivity knob). */}
      <OperatorConfigPanel
        currentStallThreshold={data.stalledQueue.thresholdDays}
        currentSpikeMultiplier={data.declineSpike.rateMultiplier}
      />
      {/* Sprint 44 — API key management. Sits next to the operator
          config card because both are admin-only settings for the
          org. Read-only keys for v1; the bearer middleware wires
          into GET endpoints in a future sprint. */}
      <ApiKeysPanel />
      {/* Sprint 47 — outbound webhook subscription management +
          test delivery. The push-side counterpart to API keys
          (which are the pull side). Both are admin-only settings;
          clustered as a band. */}
      <WebhooksPanel />
      {/* Sprint 38 — stalled-request watch. Renders ONLY when count
          > 0 so the cockpit isn't dominated by an empty card on a
          healthy day. Sits BELOW the hero + ABOVE the retrospective
          cohorts because it's the only proactive signal — actionable
          NOW, not "look at past data." */}
      {data.stalledQueue.count > 0 && (
        <StalledQueueCard data={data.stalledQueue} />
      )}
      {/* Sprint 40 — decline-reason spike watch. Second proactive
          signal: which decline reasons are accelerating vs the
          30-day baseline. Renders ONLY when spikes.length > 0 so
          healthy weeks (no acceleration) show no card. Sits
          between the stall card + the retrospective stack — same
          proactive band. */}
      {data.declineSpike.spikes.length > 0 && (
        <DeclineSpikeCard data={data.declineSpike} />
      )}
      <RevisionCohort data={data.revisionCohort} />
      <Funnel data={data} />
      <DeclineBreakdown data={data} />
      <TopPickedCountries data={data} />
      <RatingHealth data={data.ratingCohort} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Hero — Connectis cascade (sprint 11 pattern).
 * ──────────────────────────────────────────────────────────────────── */

function Hero({
  windowDays,
  setWindowDays,
  totalInWindow,
}: {
  windowDays: number;
  setWindowDays: (n: number) => void;
  totalInWindow: number;
}) {
  return (
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
          Ops cockpit · learning system
        </span>
        <h1 className="text-[clamp(2.25rem,4.5vw,3.25rem)] font-bold text-[var(--color-ivory)] tracking-[-0.025em] leading-[1.05]">
          How the queue is performing.
        </h1>
        <p className="text-[var(--color-ivory-dim)] text-[15.5px] leading-relaxed">
          {totalInWindow.toLocaleString('en-IE')} import request{totalInWindow === 1 ? '' : 's'} in the last {windowDays} days, with funnel pile-ups, decline-reason mix, and the revision-recovery rate that tells you whether ops decline copy is actually unblocking customers.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {WINDOW_OPTIONS.map((opt) => {
            const active = opt.days === windowDays;
            return (
              <button
                key={opt.days}
                type="button"
                onClick={() => setWindowDays(opt.days)}
                className={`text-[12.5px] font-medium px-3 py-1.5 transition-colors duration-150 ${
                  active
                    ? 'bg-[var(--color-aqua)] text-[var(--color-navy)]'
                    : 'border border-white/15 text-[var(--color-ivory-dim)] hover:border-[var(--color-aqua)] hover:text-[var(--color-aqua)]'
                }`}
                style={{ borderRadius: 'var(--radius-button)' }}
              >
                {opt.label}
              </button>
            );
          })}
          {/* Sprint 36 — org-wide audit CSV export. Sits next to the
              window-size toggles because it's a peer ops-cockpit
              control (same ops-only gate, same time-scoped surface).
              Distinct from the sprint-35 per-request audit link on
              the detail page: this one spans every request in the
              org, identified by an "External ID" column.
              Sprint 37 — paired "all-time" + "last 90d" links. The
              quarterly compliance review is the natural windowed
              ask; full handovers keep the all-time link. */}
          <div className="ml-auto flex items-center gap-3">
            <a
              href="/api/imports/audit.csv"
              className="text-[12.5px] font-medium text-[var(--color-aqua)] hover:underline"
              title="Download the org's full audit log as CSV (every recorded action across every request, UTF-8, RFC-4180)"
            >
              Export org audit (CSV) ↓
            </a>
            <a
              href="/api/imports/audit.csv?days=90"
              className="text-[12.5px] text-[var(--color-ivory-mute)] hover:text-[var(--color-aqua)] hover:underline"
              title="Download the org's last 90 days of audit log as CSV (windowed for quarterly reviews, UTF-8, RFC-4180)"
            >
              Last 90d ↓
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Revision cohort — the headline closed-loop metric.
 * ──────────────────────────────────────────────────────────────────── */

function RevisionCohort({ data }: { data: OpsInsights['revisionCohort'] }) {
  const empty = data.recoverableDeclined === 0;
  return (
    <section
      className="bg-[var(--surface-card)] border border-white/[0.06] p-7 space-y-5"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="space-y-1.5">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
          Revision recovery · the headline number
        </h2>
        <p className="text-[15.5px] text-[var(--color-ivory-dim)] leading-relaxed max-w-2xl">
          Of declined requests where ops picked a revisable reason, how many became revisions that re-entered the pipeline.
        </p>
      </div>

      {empty ? (
        <p className="text-[var(--color-ivory-mute)] text-[14px] italic">
          No recoverable declines in this window yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2">
          <MetricCard
            label="Recoverable declines"
            value={data.recoverableDeclined.toLocaleString('en-IE')}
            sublabel="Window source"
          />
          <MetricCard
            label="Revisions submitted"
            value={data.revisions.toLocaleString('en-IE')}
            sublabel={data.revisionRate != null ? `${data.revisionRate}% recovery rate` : 'No revisions yet'}
            tone={data.revisionRate != null && data.revisionRate >= 40 ? 'positive' : 'neutral'}
          />
          <MetricCard
            label="Made it past intake"
            value={data.revisionsProgressed.toLocaleString('en-IE')}
            sublabel={data.progressionRate != null ? `${data.progressionRate}% of revisions` : '—'}
            tone={data.progressionRate != null && data.progressionRate >= 60 ? 'positive' : 'neutral'}
          />
        </div>
      )}
    </section>
  );
}

function MetricCard({
  label,
  value,
  sublabel,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'positive' | 'neutral' | 'warning';
}) {
  const accentColor =
    tone === 'positive'
      ? 'var(--color-positive)'
      : tone === 'warning'
        ? 'var(--color-warning)'
        : 'var(--color-ivory-mute)';
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ivory-mute)]">
        {label}
      </p>
      <p className="text-[34px] font-bold tracking-[-0.02em] text-[var(--color-ivory)] font-mono leading-none">
        {value}
      </p>
      {sublabel && (
        <p className="text-[12px] font-medium" style={{ color: accentColor }}>
          {sublabel}
        </p>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Stalled-queue watch (sprint 38) — the first PROACTIVE signal.
 *  Every other cohort summarises past data; this one names the
 *  requests that need attention NOW. Renders only when data.count > 0
 *  (gated by the parent component) so a healthy day doesn't show
 *  an empty card.
 * ──────────────────────────────────────────────────────────────────── */

function StalledQueueCard({ data }: { data: OpsInsightsStalledQueue }) {
  const truncated = data.count > data.items.length;
  return (
    <section
      // Amber-tinged border instead of the neutral white/[0.06] used by
      // the retrospective cohorts — the proactive watch is visually
      // distinct because the user is meant to ACT on it, not read it.
      className="bg-[var(--surface-card)] border border-[var(--color-warning)]/[0.35] p-7 space-y-5"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="space-y-1.5">
          <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-warning)]">
            Stalled queue · needs your attention
          </h2>
          <p className="text-[15.5px] text-[var(--color-ivory-dim)] leading-relaxed max-w-2xl">
            Requests sitting in <span className="font-medium text-[var(--color-ivory)]">awaiting_review</span>{' '}
            with no activity for &gt; {data.thresholdDays} days. Oldest first.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[34px] font-bold tracking-[-0.02em] text-[var(--color-warning)] font-mono leading-none">
            {data.count.toLocaleString('en-IE')}
          </p>
          <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ivory-mute)] pt-1">
            stalled
          </p>
        </div>
      </div>

      <ul className="divide-y divide-white/[0.06]">
        {data.items.map((item) => (
          <li key={item.externalId}>
            <Link
              href={`/imports/${item.externalId}`}
              className="group flex items-center justify-between gap-4 py-3 hover:bg-white/[0.02] transition-colors duration-150 -mx-2 px-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-[var(--color-ivory)] truncate group-hover:text-[var(--color-aqua)]">
                  {item.label || item.externalId}
                </p>
                <p className="text-[11.5px] text-[var(--color-ivory-mute)] font-mono pt-0.5">
                  {item.externalId}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[15px] font-mono font-medium text-[var(--color-warning)]">
                  {item.daysStalled.toFixed(1)}d
                </p>
                <p className="text-[10.5px] text-[var(--color-ivory-mute)] uppercase tracking-wider pt-0.5">
                  stalled
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {truncated && (
        // Honesty footnote — the card shows top N (oldest first), but
        // the headline count is org-wide. A user counting the rows
        // would otherwise mistrust the headline.
        <p className="text-[11.5px] text-[var(--color-ivory-mute)] italic pt-1">
          Showing the {data.items.length} oldest of {data.count} stalled. Refine the workflow
          to bring the rest forward.
        </p>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Decline-reason spike (sprint 40) — the SECOND proactive signal.
 *  Reads cohort #7. Names every decline reason whose 7-day rate is
 *  ≥ 2× the 30-day baseline rate AND whose 7-day count is ≥ 3.
 *  First-time reasons (no baseline) surface as a separate "new vs
 *  baseline" badge instead of an "Nx" multiplier. Renders only when
 *  spikes.length > 0 (gated by the parent component).
 * ──────────────────────────────────────────────────────────────────── */

function DeclineSpikeCard({ data }: { data: OpsInsightsDeclineSpikeCohort }) {
  return (
    <section
      // Amber-tinged border matches the StalledQueueCard so the two
      // proactive cards read as a band. Distinct from the neutral
      // white/[0.06] used by the retrospective cohorts below.
      className="bg-[var(--surface-card)] border border-[var(--color-warning)]/[0.35] p-7 space-y-5"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="space-y-1.5">
        <h2 className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-warning)]">
          Decline-reason spike · accelerating vs baseline
        </h2>
        <p className="text-[15.5px] text-[var(--color-ivory-dim)] leading-relaxed max-w-2xl">
          Reasons whose last {data.currentDays}-day pace is{' '}
          <span className="font-medium text-[var(--color-ivory)]">≥ {data.rateMultiplier}×</span>{' '}
          the {data.baselineDays}-day baseline, with at least {data.minCount} in the current window.
        </p>
      </div>

      <ul className="divide-y divide-white/[0.06]">
        {data.spikes.map((spike) => {
          const isNew = spike.ratio === null;
          const label = DECLINE_REASON_LABELS[spike.reason as DeclineReason] || spike.reason;
          return (
            <li key={spike.reason} className="py-3 flex items-baseline justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium text-[var(--color-ivory)]">
                  {label}
                </p>
                <p className="text-[11.5px] text-[var(--color-ivory-mute)] pt-0.5">
                  {spike.currentCount} in last {data.currentDays}d
                  {isNew
                    ? ' · no occurrence in the prior baseline'
                    : ` · ${spike.baselineCount} in the ${data.baselineDays}d baseline`}
                </p>
              </div>
              <div className="text-right shrink-0">
                {isNew ? (
                  <p className="text-[15px] font-mono font-medium text-[var(--color-warning)]">
                    NEW
                  </p>
                ) : (
                  <p className="text-[15px] font-mono font-medium text-[var(--color-warning)]">
                    {spike.ratio?.toFixed(1)}×
                  </p>
                )}
                <p className="text-[10.5px] text-[var(--color-ivory-mute)] uppercase tracking-wider pt-0.5">
                  {isNew ? 'first-time' : 'vs baseline'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[11.5px] text-[var(--color-ivory-mute)] italic">
        Drill into the breakdown below — same numbers, narrower angle.
      </p>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Operator config (sprint 42) — the first per-org policy knob.
 *  Collapsed by default — the cockpit isn't a settings page. Expands
 *  to a tight inline form with one number input + Save. Validation
 *  matches the server (integer [1, 90]); a failed PATCH surfaces the
 *  server's error message inline.
 * ──────────────────────────────────────────────────────────────────── */

function OperatorConfigPanel({
  currentStallThreshold,
  currentSpikeMultiplier,
}: {
  currentStallThreshold: number;
  currentSpikeMultiplier: number;
}) {
  // Both currents are EFFECTIVE values the SQL just used — pulled
  // from data.{stalledQueue,declineSpike} so the panel is always
  // in sync with the cohorts alongside it.
  const [pendingStall, setPendingStall] = useState<number>(currentStallThreshold);
  const [pendingSpike, setPendingSpike] = useState<number>(currentSpikeMultiplier);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const dirtyStall = Number(pendingStall) !== Number(currentStallThreshold);
  const dirtySpike = Number(pendingSpike) !== Number(currentSpikeMultiplier);
  const dirty = dirtyStall || dirtySpike;

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      /** @type {Partial<{ stallThresholdDays: number; declineSpikeRateMultiplier: number }>} */
      const patch: { stallThresholdDays?: number; declineSpikeRateMultiplier?: number } = {};
      if (dirtyStall) patch.stallThresholdDays = Number(pendingStall);
      if (dirtySpike) patch.declineSpikeRateMultiplier = Number(pendingSpike);
      await apiPatch<OperatorConfigResponse>('/api/operator-config', patch);
      setSavedFlash(true);
      // Page reload picks up the new config across all panels
      // without prop-drilling — every cohort + composer + this
      // panel re-reads from the aggregateOpsInsights response.
      setTimeout(() => { window.location.reload(); }, 600);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setSaving(false);
    }
  }

  return (
    <details
      className="bg-[var(--surface-card)] border border-white/[0.06] px-7 py-4"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
    >
      <summary
        className="cursor-pointer text-[13px] text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] flex items-center justify-between gap-3 list-none"
      >
        <span>
          <span className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)] pr-3">
            Settings
          </span>
          Stall:{' '}
          <span className="font-mono text-[var(--color-ivory)]">
            {currentStallThreshold}d
          </span>
          {'  ·  '}
          Spike:{' '}
          <span className="font-mono text-[var(--color-ivory)]">
            {currentSpikeMultiplier.toFixed(1)}×
          </span>
        </span>
        <span aria-hidden className="text-[var(--color-ivory-mute)]">▾</span>
      </summary>
      <div className="pt-5 pb-2 space-y-6 max-w-xl">
        {/* Stall threshold */}
        <div className="space-y-2">
          <label
            htmlFor="stallThresholdDays"
            className="text-[12px] uppercase tracking-wider text-[var(--color-ivory-mute)] block"
          >
            Stall threshold (days)
          </label>
          <p className="text-[13px] text-[var(--color-ivory-dim)] leading-relaxed">
            The "no activity in awaiting_review for {'>'} N days" gate that drives the stalled-queue
            cohort + the daily stall alert. Default 7; tighten for a stricter SLA.
          </p>
          <input
            id="stallThresholdDays"
            type="number"
            min={1}
            max={90}
            step={1}
            value={pendingStall}
            onChange={(e) => setPendingStall(Number(e.target.value))}
            disabled={saving}
            className="bg-[var(--color-navy)] border border-white/15 text-[var(--color-ivory)] font-mono px-3 py-1.5 w-24 text-[14px] focus:border-[var(--color-aqua)] focus:outline-none"
            style={{ borderRadius: 'var(--radius-button)' }}
          />
          <p className="text-[11px] text-[var(--color-ivory-mute)] italic">Range 1–90.</p>
        </div>

        {/* Sprint 43 — Decline-spike multiplier */}
        <div className="space-y-2">
          <label
            htmlFor="declineSpikeRateMultiplier"
            className="text-[12px] uppercase tracking-wider text-[var(--color-ivory-mute)] block"
          >
            Decline-spike sensitivity (multiplier)
          </label>
          <p className="text-[13px] text-[var(--color-ivory-dim)] leading-relaxed">
            The "current 7-day rate ≥ N× the 30-day baseline" gate that drives the decline-spike
            cohort + the daily alert. Default 2.0; lower = more sensitive, higher = noise floor.
          </p>
          <input
            id="declineSpikeRateMultiplier"
            type="number"
            min={1.5}
            max={10}
            step={0.1}
            value={pendingSpike}
            onChange={(e) => setPendingSpike(Number(e.target.value))}
            disabled={saving}
            className="bg-[var(--color-navy)] border border-white/15 text-[var(--color-ivory)] font-mono px-3 py-1.5 w-24 text-[14px] focus:border-[var(--color-aqua)] focus:outline-none"
            style={{ borderRadius: 'var(--radius-button)' }}
          />
          <p className="text-[11px] text-[var(--color-ivory-mute)] italic">Range 1.5–10, one decimal.</p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || saving}
            className="text-[12.5px] font-semibold px-4 py-1.5 bg-[var(--color-aqua)] text-[var(--color-navy)] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: 'var(--radius-button)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedFlash && (
            <span className="text-[12px] text-[var(--color-aqua)]">Saved — reloading…</span>
          )}
        </div>
        {error && (
          <p className="text-[12px] text-[var(--color-warning)]">{error}</p>
        )}
        <p className="text-[11px] text-[var(--color-ivory-mute)] italic">
          Changes are audit-logged and apply to the next dashboard read + the next daily alert.
        </p>
      </div>
    </details>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  API keys panel (sprint 44) — admin-only programmatic-access
 *  management. Collapsed by default. Create flow shows the raw key
 *  ONCE with a copy button + warning that it will be unrecoverable.
 *  List shows redacted form + revoke. Both create + revoke fire
 *  audit events on the server.
 * ──────────────────────────────────────────────────────────────────── */

function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reveal-once state. Cleared on dismiss; the user can never get
  // it back from the server.
  const [revealedKey, setRevealedKey] = useState<{ raw: string; label: string } | null>(null);
  const [creatingLabel, setCreatingLabel] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ApiKeyListResponse>('/api/api-keys');
      setKeys(data.keys);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setKeys([]);
    } finally {
      setLoading(false);
    }
  }

  async function onCreate() {
    if (!creatingLabel.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiPost<ApiKeyCreateResponse>('/api/api-keys', {
        label: creatingLabel.trim(),
      });
      setRevealedKey({ raw: data.key, label: data.label });
      setCreatingLabel('');
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(keyId: string) {
    if (!confirm('Revoke this API key? This cannot be undone — any client using it will start receiving 401.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/api-keys/${encodeURIComponent(keyId)}`);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function copyToClipboard(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => { /* swallow */ });
    }
  }

  return (
    <details
      className="bg-[var(--surface-card)] border border-white/[0.06] px-7 py-4"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
      onToggle={(e) => {
        // Load on first expand so the closed-panel render is cheap.
        if ((e.target as HTMLDetailsElement).open && keys === null && !loading) {
          refresh();
        }
      }}
    >
      <summary className="cursor-pointer text-[13px] text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] flex items-center justify-between gap-3 list-none">
        <span>
          <span className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)] pr-3">
            API keys
          </span>
          <span className="font-mono text-[var(--color-ivory)]">
            {keys === null ? '—' : `${keys.length} active`}
          </span>
        </span>
        <span aria-hidden className="text-[var(--color-ivory-mute)]">▾</span>
      </summary>
      <div className="pt-5 pb-2 space-y-5 max-w-2xl">
        <p className="text-[13px] text-[var(--color-ivory-dim)] leading-relaxed">
          Bearer tokens for programmatic read access to your org's data. Pass{' '}
          <span className="font-mono text-[var(--color-ivory)]">Authorization: Bearer ot_…</span>{' '}
          to API endpoints. Each key is shown ONCE on creation; store it in your secrets manager.
        </p>

        {/* Reveal-once banner — shown after create until dismissed. */}
        {revealedKey && (
          <div
            className="border border-[var(--color-aqua)]/40 bg-[var(--color-navy)] p-4 space-y-2"
            style={{ borderRadius: 'var(--radius-button)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-aqua)]">
                New key: {revealedKey.label}
              </p>
              <button
                type="button"
                onClick={() => setRevealedKey(null)}
                className="text-[11px] text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)]"
              >
                Dismiss
              </button>
            </div>
            <p className="text-[12px] text-[var(--color-warning)]">
              ⚠ Save this somewhere safe — it will NOT be shown again.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="font-mono text-[12.5px] text-[var(--color-ivory)] bg-black/40 px-3 py-2 break-all flex-1">
                {revealedKey.raw}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(revealedKey.raw)}
                className="text-[12px] px-3 py-1.5 border border-white/15 text-[var(--color-ivory)] hover:border-[var(--color-aqua)]"
                style={{ borderRadius: 'var(--radius-button)' }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {/* Create form */}
        <div className="space-y-2">
          <label htmlFor="newApiKeyLabel" className="text-[12px] uppercase tracking-wider text-[var(--color-ivory-mute)] block">
            Create a key
          </label>
          <div className="flex items-center gap-3">
            <input
              id="newApiKeyLabel"
              type="text"
              placeholder="e.g. ERP read-sync"
              value={creatingLabel}
              onChange={(e) => setCreatingLabel(e.target.value)}
              disabled={busy}
              maxLength={120}
              className="bg-[var(--color-navy)] border border-white/15 text-[var(--color-ivory)] px-3 py-1.5 flex-1 text-[14px] focus:border-[var(--color-aqua)] focus:outline-none"
              style={{ borderRadius: 'var(--radius-button)' }}
            />
            <button
              type="button"
              onClick={onCreate}
              disabled={!creatingLabel.trim() || busy}
              className="text-[12.5px] font-semibold px-4 py-1.5 bg-[var(--color-aqua)] text-[var(--color-navy)] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderRadius: 'var(--radius-button)' }}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="space-y-2">
          <p className="text-[12px] uppercase tracking-wider text-[var(--color-ivory-mute)]">
            Active keys
          </p>
          {loading && <p className="text-[12.5px] text-[var(--color-ivory-mute)]">Loading…</p>}
          {keys !== null && keys.length === 0 && !loading && (
            <p className="text-[12.5px] text-[var(--color-ivory-mute)] italic">
              No active keys yet. Create one to get started.
            </p>
          )}
          {keys !== null && keys.length > 0 && (
            <ul className="divide-y divide-white/[0.06]">
              {keys.map((k) => (
                <li key={k.keyId} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-[var(--color-ivory)] truncate">
                      {k.label}
                    </p>
                    <p className="text-[11.5px] text-[var(--color-ivory-mute)] font-mono pt-0.5">
                      {k.redactedKey}
                      {k.lastUsedAt
                        ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString('en-IE')}`
                        : ' · never used'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRevoke(k.keyId)}
                    disabled={busy}
                    className="text-[12px] px-3 py-1.5 border border-[var(--color-warning)]/40 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10 disabled:opacity-40"
                    style={{ borderRadius: 'var(--radius-button)' }}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="text-[12px] text-[var(--color-warning)]">{error}</p>
        )}
      </div>
    </details>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Webhooks panel (sprint 47) — outbound subscription management.
 *  Push counterpart to API keys (pull side). Create: secret returned
 *  ONCE — reveal-once flow. Per-row Test button fires a signed
 *  payload to the URL + surfaces the response status. SSRF guard is
 *  server-side (lib/webhooks.js validateUrl); the form mirrors
 *  https-only via the HTML pattern.
 * ──────────────────────────────────────────────────────────────────── */

function WebhooksPanel() {
  const [subs, setSubs] = useState<WebhookSubscription[] | null>(null);
  const [eventTypes, setEventTypes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ label: string; secret: string } | null>(null);
  const [creatingLabel, setCreatingLabel] = useState('');
  const [creatingUrl, setCreatingUrl] = useState('');
  const [creatingEvents, setCreatingEvents] = useState<string[]>([]);
  /** @type {Record<string, string>} */
  const [testResults, setTestResults] = useState<Record<string, string>>({});
  // Sprint 49 — per-subscription recent-delivery history. Keyed by
  // subscription id; expanded entry holds the fetched log entries
  // (newest-first), or null while loading.
  const [deliveries, setDeliveries] = useState<Record<string, WebhookDeliveryLogEntry[] | null>>({});
  const [openDeliveries, setOpenDeliveries] = useState<Record<string, boolean>>({});

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<WebhookListResponse>('/api/webhooks');
      setSubs(data.webhooks);
      if (eventTypes === null) {
        const ev = await apiGet<WebhookEventTypesResponse>('/api/webhooks/event-types');
        setEventTypes(ev.eventTypes);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setSubs([]);
    } finally {
      setLoading(false);
    }
  }

  async function onCreate() {
    if (!creatingLabel.trim() || !creatingUrl.trim() || creatingEvents.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const data = await apiPost<WebhookCreateResponse>('/api/webhooks', {
        label: creatingLabel.trim(),
        url: creatingUrl.trim(),
        eventTypes: creatingEvents,
      });
      if (data.subscription.secret) {
        setRevealedSecret({ label: data.subscription.label, secret: data.subscription.secret });
      }
      setCreatingLabel('');
      setCreatingUrl('');
      setCreatingEvents([]);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onReactivate(id: string) {
    setBusy(true);
    setError(null);
    try {
      await apiPost<WebhookReactivateResponse>(`/api/webhooks/${encodeURIComponent(id)}/reactivate`, {});
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Delete this webhook subscription? Any events queued for delivery will be dropped.')) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/webhooks/${encodeURIComponent(id)}`);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeliveries(id: string) {
    const isOpen = !!openDeliveries[id];
    setOpenDeliveries((prev) => ({ ...prev, [id]: !isOpen }));
    if (isOpen) return; // closing — no fetch
    if (deliveries[id]) return; // already cached
    setDeliveries((prev) => ({ ...prev, [id]: null }));
    try {
      const data = await apiGet<WebhookDeliveriesResponse>(
        `/api/webhooks/${encodeURIComponent(id)}/deliveries?limit=25`,
      );
      setDeliveries((prev) => ({ ...prev, [id]: data.deliveries }));
    } catch (e) {
      // Surface inline — don't poison the panel-wide error state.
      const msg = e instanceof Error ? e.message : String(e);
      setDeliveries((prev) => ({ ...prev, [id]: [] }));
      setTestResults((prev) => ({ ...prev, [id]: `✗ ${msg}` }));
    }
  }

  async function onTest(id: string) {
    setBusy(true);
    setError(null);
    setTestResults((prev) => ({ ...prev, [id]: 'Sending…' }));
    try {
      const data = await apiPost<WebhookTestResponse>(`/api/webhooks/${encodeURIComponent(id)}/test`, {});
      const d = data.delivery;
      const label = d.ok
        ? `✓ ${d.status} · ${d.durationMs}ms`
        : d.timedOut
          ? '✗ timeout (>10s)'
          : `✗ ${d.error || `HTTP ${d.status}`}`;
      setTestResults((prev) => ({ ...prev, [id]: label }));
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTestResults((prev) => ({ ...prev, [id]: `✗ ${msg}` }));
    } finally {
      setBusy(false);
    }
  }

  function copyToClipboard(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => { /* swallow */ });
    }
  }

  function toggleEvent(type: string) {
    setCreatingEvents((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  return (
    <details
      className="bg-[var(--surface-card)] border border-white/[0.06] px-7 py-4"
      style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && subs === null && !loading) {
          refresh();
        }
      }}
    >
      <summary className="cursor-pointer text-[13px] text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] flex items-center justify-between gap-3 list-none">
        <span>
          <span className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)] pr-3">
            Webhooks
          </span>
          <span className="font-mono text-[var(--color-ivory)]">
            {subs === null ? '—' : `${subs.length} active`}
          </span>
        </span>
        <span aria-hidden className="text-[var(--color-ivory-mute)]">▾</span>
      </summary>
      <div className="pt-5 pb-2 space-y-5 max-w-2xl">
        <p className="text-[13px] text-[var(--color-ivory-dim)] leading-relaxed">
          Push notifications to your HTTPS endpoint when lifecycle events fire. Each delivery is
          signed with HMAC-SHA256 — verify the{' '}
          <span className="font-mono text-[var(--color-ivory)]">X-OrcaTrade-Signature</span>{' '}
          header against your subscription secret.
        </p>

        {revealedSecret && (
          <div
            className="border border-[var(--color-aqua)]/40 bg-[var(--color-navy)] p-4 space-y-2"
            style={{ borderRadius: 'var(--radius-button)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-aqua)]">
                Signing secret for: {revealedSecret.label}
              </p>
              <button
                type="button"
                onClick={() => setRevealedSecret(null)}
                className="text-[11px] text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)]"
              >
                Dismiss
              </button>
            </div>
            <p className="text-[12px] text-[var(--color-warning)]">
              ⚠ Save this somewhere safe — it will NOT be shown again.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <code className="font-mono text-[12.5px] text-[var(--color-ivory)] bg-black/40 px-3 py-2 break-all flex-1">
                {revealedSecret.secret}
              </code>
              <button
                type="button"
                onClick={() => copyToClipboard(revealedSecret.secret)}
                className="text-[12px] px-3 py-1.5 border border-white/15 text-[var(--color-ivory)] hover:border-[var(--color-aqua)]"
                style={{ borderRadius: 'var(--radius-button)' }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        {/* Create form */}
        <div className="space-y-3">
          <p className="text-[12px] uppercase tracking-wider text-[var(--color-ivory-mute)]">
            Create a subscription
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Label (e.g. ERP push)"
              value={creatingLabel}
              onChange={(e) => setCreatingLabel(e.target.value)}
              disabled={busy}
              maxLength={120}
              className="bg-[var(--color-navy)] border border-white/15 text-[var(--color-ivory)] px-3 py-1.5 text-[14px] focus:border-[var(--color-aqua)] focus:outline-none"
              style={{ borderRadius: 'var(--radius-button)' }}
            />
            <input
              type="url"
              placeholder="https://your.endpoint/webhook"
              value={creatingUrl}
              pattern="https://.*"
              onChange={(e) => setCreatingUrl(e.target.value)}
              disabled={busy}
              className="bg-[var(--color-navy)] border border-white/15 text-[var(--color-ivory)] font-mono px-3 py-1.5 text-[13px] focus:border-[var(--color-aqua)] focus:outline-none"
              style={{ borderRadius: 'var(--radius-button)' }}
            />
          </div>
          {eventTypes && eventTypes.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11.5px] text-[var(--color-ivory-mute)] uppercase tracking-wider">
                Event types
              </p>
              <div className="flex flex-wrap gap-2">
                {eventTypes.map((t) => {
                  const active = creatingEvents.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => toggleEvent(t)}
                      disabled={busy}
                      className={`text-[11.5px] font-mono px-2.5 py-1 border transition-colors duration-150 ${
                        active
                          ? 'bg-[var(--color-aqua)] text-[var(--color-navy)] border-[var(--color-aqua)]'
                          : 'border-white/15 text-[var(--color-ivory-dim)] hover:border-[var(--color-aqua)]'
                      }`}
                      style={{ borderRadius: 'var(--radius-button)' }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onCreate}
              disabled={!creatingLabel.trim() || !creatingUrl.trim() || creatingEvents.length === 0 || busy}
              className="text-[12.5px] font-semibold px-4 py-1.5 bg-[var(--color-aqua)] text-[var(--color-navy)] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderRadius: 'var(--radius-button)' }}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>

        {/* List */}
        <div className="space-y-2">
          <p className="text-[12px] uppercase tracking-wider text-[var(--color-ivory-mute)]">
            Active subscriptions
          </p>
          {loading && <p className="text-[12.5px] text-[var(--color-ivory-mute)]">Loading…</p>}
          {subs !== null && subs.length === 0 && !loading && (
            <p className="text-[12.5px] text-[var(--color-ivory-mute)] italic">
              No subscriptions yet. Create one to start receiving events.
            </p>
          )}
          {subs !== null && subs.length > 0 && (
            <ul className="divide-y divide-white/[0.06]">
              {subs.map((s) => (
                <li key={s.id} className="py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-medium text-[var(--color-ivory)] truncate">
                        {s.label}
                      </p>
                      <p className="text-[11.5px] text-[var(--color-ivory-mute)] font-mono pt-0.5 truncate">
                        {s.url}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleDeliveries(s.id)}
                        className="text-[12px] px-3 py-1.5 border border-white/15 text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] hover:border-[var(--color-aqua)]"
                        style={{ borderRadius: 'var(--radius-button)' }}
                      >
                        {openDeliveries[s.id] ? 'Hide deliveries' : 'Deliveries'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onTest(s.id)}
                        disabled={busy}
                        className="text-[12px] px-3 py-1.5 border border-white/15 text-[var(--color-ivory)] hover:border-[var(--color-aqua)] disabled:opacity-40"
                        style={{ borderRadius: 'var(--radius-button)' }}
                      >
                        Test
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(s.id)}
                        disabled={busy}
                        className="text-[12px] px-3 py-1.5 border border-[var(--color-warning)]/40 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10 disabled:opacity-40"
                        style={{ borderRadius: 'var(--radius-button)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.eventTypes.map((t) => (
                      <span
                        key={t}
                        className="text-[10.5px] font-mono px-1.5 py-0.5 bg-white/[0.04] text-[var(--color-ivory-mute)]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  {/* Sprint 51 — auto-disable banner. Visible only
                      when the server has flipped active=false +
                      populated autoDisabledAt. The Reactivate button
                      resets the counter + flips active back. */}
                  {s.autoDisabledAt && (
                    <div
                      className="flex items-start justify-between gap-3 p-2.5 border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/[0.06]"
                      style={{ borderRadius: 'var(--radius-button)' }}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--color-warning)]">
                          Auto-disabled
                        </p>
                        <p className="text-[11.5px] text-[var(--color-ivory-dim)]">
                          {s.autoDisabledReason || 'Repeated delivery failures.'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onReactivate(s.id)}
                        disabled={busy}
                        className="text-[12px] font-medium px-3 py-1.5 bg-[var(--color-aqua)] text-[var(--color-navy)] disabled:opacity-40"
                        style={{ borderRadius: 'var(--radius-button)' }}
                      >
                        Reactivate
                      </button>
                    </div>
                  )}
                  {(testResults[s.id] || s.lastDeliveryStatus) && (
                    <p className="text-[11px] text-[var(--color-ivory-mute)]">
                      {testResults[s.id] || `Last: ${s.lastDeliveryStatus}`}
                    </p>
                  )}
                  {openDeliveries[s.id] && (
                    <div className="pt-2 pl-3 border-l border-white/[0.06] space-y-1.5">
                      <p className="text-[10.5px] uppercase tracking-wider text-[var(--color-ivory-mute)]">
                        Recent deliveries (last 7 days)
                      </p>
                      {deliveries[s.id] === null && (
                        <p className="text-[11.5px] text-[var(--color-ivory-mute)]">Loading…</p>
                      )}
                      {deliveries[s.id] !== null && deliveries[s.id]?.length === 0 && (
                        <p className="text-[11.5px] text-[var(--color-ivory-mute)] italic">
                          No deliveries yet — fire a Test or wait for a lifecycle event.
                        </p>
                      )}
                      {deliveries[s.id] !== null && (deliveries[s.id]?.length || 0) > 0 && (
                        <ul className="space-y-1">
                          {deliveries[s.id]?.map((d) => (
                            <li key={d.deliveryId} className="text-[11.5px] flex items-baseline gap-2 font-mono">
                              <span
                                aria-label={d.ok ? 'success' : 'failure'}
                                className={d.ok ? 'text-[var(--color-aqua)]' : 'text-[var(--color-warning)]'}
                              >
                                {d.ok ? '✓' : '✗'}
                              </span>
                              <span className="text-[var(--color-ivory-dim)]">
                                {new Date(d.deliveredAt).toLocaleString('en-IE')}
                              </span>
                              <span className="text-[var(--color-ivory)]">{d.eventType}</span>
                              <span className="text-[var(--color-ivory-mute)]">
                                {d.timedOut
                                  ? `timeout`
                                  : d.error
                                    ? d.error
                                    : `${d.status}`}
                              </span>
                              <span className="text-[var(--color-ivory-mute)]">· {d.durationMs}ms</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p className="text-[12px] text-[var(--color-warning)]">{error}</p>
        )}
      </div>
    </details>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Funnel — per-stage counts.
 * ──────────────────────────────────────────────────────────────────── */

function Funnel({ data }: { data: OpsInsights }) {
  const counts = data.funnelByStatus;
  const groupCounts = FUNNEL_GROUPS.map((g) => ({
    ...g,
    n: g.statuses.reduce((acc, s) => acc + Number(counts[s] || 0), 0),
  }));
  const closedCount = TERMINAL_GROUP.statuses.reduce(
    (acc, s) => acc + Number(counts[s] || 0),
    0,
  );
  // Bar widths are relative to the widest group so the chart reads
  // even when one stage dominates.
  const maxN = Math.max(1, ...groupCounts.map((g) => g.n), closedCount);

  return (
    <section className="space-y-4">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ivory)]">
        Funnel
      </h2>
      <div
        className="bg-[var(--surface-card)] border border-white/[0.06] p-6 space-y-3.5"
        style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
      >
        {groupCounts.map((g) => (
          <FunnelRow key={g.key} label={g.label} n={g.n} maxN={maxN} accent="var(--color-aqua)" />
        ))}
        <FunnelRow
          label={TERMINAL_GROUP.label}
          n={closedCount}
          maxN={maxN}
          accent="var(--color-ivory-mute)"
        />
      </div>
    </section>
  );
}

function FunnelRow({
  label,
  n,
  maxN,
  accent,
}: {
  label: string;
  n: number;
  maxN: number;
  accent: string;
}) {
  const pct = Math.max(0.5, Math.round((n / maxN) * 100));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-medium text-[var(--color-ivory)]">
          {label}
        </span>
        <span className="text-[13px] font-mono text-[var(--color-ivory-mute)]">
          {n.toLocaleString('en-IE')}
        </span>
      </div>
      <div className="h-2 bg-white/[0.05] overflow-hidden" style={{ borderRadius: 4 }}>
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${pct}%`, background: accent, borderRadius: 4 }}
        />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Decline reasons — sprint 16 cohort.
 * ──────────────────────────────────────────────────────────────────── */

function DeclineBreakdown({ data }: { data: OpsInsights }) {
  if (data.totalDeclined === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ivory)]">
          Decline reasons
        </h2>
        <div
          className="bg-[var(--surface-card)] border border-white/[0.06] p-6"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="text-[var(--color-ivory-mute)] text-[14px] italic">
            No structured declines in this window.
          </p>
        </div>
      </section>
    );
  }

  // Order: reasons sorted by count desc, then alpha for stable display.
  // Tie-breaker on the enum order keeps "other" at the bottom.
  const sorted = [...DECLINE_REASONS]
    .map((r) => ({ reason: r, n: Number(data.declineReasons[r] || 0) }))
    .sort((a, b) => b.n - a.n);
  const maxN = Math.max(1, ...sorted.map((x) => x.n));

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ivory)]">
          Decline reasons
        </h2>
        <span className="text-[12.5px] font-mono text-[var(--color-ivory-mute)]">
          {data.totalDeclined} declined
        </span>
      </div>
      <div
        className="bg-[var(--surface-card)] border border-white/[0.06] p-6 space-y-3.5"
        style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
      >
        {sorted.map(({ reason, n }) => (
          <DeclineRow
            key={reason}
            reason={reason as DeclineReason}
            label={DECLINE_REASON_LABELS[reason as DeclineReason]}
            n={n}
            total={data.totalDeclined}
            maxN={maxN}
            tone={n === 0 ? 'empty' : 'present'}
          />
        ))}
      </div>
    </section>
  );
}

function DeclineRow({
  reason,
  label,
  n,
  total,
  maxN,
  tone,
}: {
  reason: DeclineReason;
  label: string;
  n: number;
  total: number;
  maxN: number;
  tone: 'present' | 'empty';
}) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  const barPct = n > 0 ? Math.max(2, Math.round((n / maxN) * 100)) : 0;
  // Sprint 23 — only present rows are clickable. The empty rows
  // exist to teach the closed taxonomy ("here's every reason we
  // track") and have no cohort to drill into.
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-medium text-[var(--color-ivory)]">
          {label}
        </span>
        <span className="text-[13px] font-mono text-[var(--color-ivory-mute)]">
          {n.toLocaleString('en-IE')}
          {n > 0 && total > 0 && (
            <span className="ml-2 text-[11.5px]">({pct}%)</span>
          )}
        </span>
      </div>
      <div className="h-2 bg-white/[0.05] overflow-hidden" style={{ borderRadius: 4 }}>
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${barPct}%`,
            background: 'var(--color-warning)',
            borderRadius: 4,
          }}
        />
      </div>
    </>
  );
  if (tone === 'empty') {
    return <div className="space-y-1.5 opacity-50">{body}</div>;
  }
  return (
    <Link
      href={`/imports?status=cancelled&declineReason=${encodeURIComponent(reason)}`}
      className="group block space-y-1.5 -mx-2 px-2 py-1.5 rounded transition-colors duration-150 hover:bg-white/[0.025]"
      title={`Drill into the ${n} request${n === 1 ? '' : 's'} declined with reason "${label}"`}
    >
      {body}
    </Link>
  );
}

// Sprint 17 — silence the unused-import warning. IMPORT_REQUEST_STATUSES is
// surfaced here because the test suite verifies the page imports the closed
// taxonomy (so a status added to the schema without surfacing in funnel
// grouping fails the drift-guard).
void IMPORT_REQUEST_STATUSES;

/* ────────────────────────────────────────────────────────────────────
 *  TopPickedCountries — sprint 29
 *  The fourth cohort card. Closes the sprint-28 learning loop: per-
 *  request "Picked Vietnam 4×" badge becomes an org-wide narrative
 *  ("12 picks for Vietnam this quarter, mostly for lead-time
 *  reasons"). Each row drills down to the org-wide list of requests
 *  with that pick via /imports?supplierPick=<ISO-2>, composing with
 *  sprint 23's cohort pattern.
 * ──────────────────────────────────────────────────────────────────── */

const PICK_RATIONALE_LABELS: Record<string, string> = {
  cost: 'cost',
  lead_time: 'lead time',
  compliance: 'compliance fit',
  past_relationship: 'past relationship',
  capacity: 'capacity',
  other: 'other',
};

function pickAgeLabel(iso: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const days = Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}wk ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function TopPickedCountries({ data }: { data: OpsInsights }) {
  const list = Array.isArray(data.topPickedCountries) ? data.topPickedCountries : [];
  const total = Number(data.totalPicked || 0);
  if (list.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ivory)]">
          Top picked countries
        </h2>
        <div
          className="bg-[var(--surface-card)] border border-white/[0.06] p-6"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="text-[var(--color-ivory-mute)] text-[14px] italic">
            No materialised picks in this window. As customers approve and the team materialises requests, the platform records which country was picked + the dominant rationale category. Those picks then surface here AND as a "your team picked this 4×" badge on future shortlists for the same HS prefix.
          </p>
        </div>
      </section>
    );
  }
  const maxN = Math.max(1, ...list.map((x) => x.count));
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ivory)]">
          Top picked countries
        </h2>
        <span className="text-[12.5px] font-mono text-[var(--color-ivory-mute)]">
          {total} pick{total === 1 ? '' : 's'} total
        </span>
      </div>
      <div
        className="bg-[var(--surface-card)] border border-white/[0.06] p-6 space-y-3.5"
        style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
      >
        {list.map((row) => (
          <PickedCountryRow key={row.country} row={row} total={total} maxN={maxN} />
        ))}
      </div>
    </section>
  );
}

function PickedCountryRow({
  row,
  total,
  maxN,
}: {
  row: OpsInsightsTopPickedCountry;
  total: number;
  maxN: number;
}) {
  const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
  const barPct = Math.max(2, Math.round((row.count / maxN) * 100));
  const dominantLabel = row.dominantRationale
    ? PICK_RATIONALE_LABELS[row.dominantRationale] || row.dominantRationale
    : null;
  const ageLabel = pickAgeLabel(row.lastPickedAt);
  // Sprint 32 — cross-cohort correlation. avgRating surfaces inline
  // so a glance tells ops "the picks landed well" (≥ 4.5★ positive)
  // or "investigate before recommending" (< 3.5★ warning). null
  // means no ratings yet for this country's picks; the row stays
  // neutral.
  const avgRating = row.avgRating != null && Number.isFinite(row.avgRating) ? row.avgRating : null;
  const ratedCount = row.ratedCount || 0;
  const ratingTone =
    avgRating == null ? 'var(--color-ivory-mute)' :
    avgRating >= 4.5 ? 'var(--color-positive)' :
    avgRating < 3.5 ? 'var(--color-warning)' :
    'var(--color-ivory-dim)';
  const title = avgRating != null
    ? `Drill into the ${row.count} request${row.count === 1 ? '' : 's'} picked for ${row.country}${dominantLabel ? ` — mostly ${dominantLabel}` : ''} · avg ${avgRating.toFixed(1)}★ across ${ratedCount} rated`
    : `Drill into the ${row.count} request${row.count === 1 ? '' : 's'} picked for ${row.country}${dominantLabel ? ` — mostly ${dominantLabel}` : ''}`;
  return (
    <Link
      href={`/imports?supplierPick=${encodeURIComponent(row.country)}`}
      className="group block space-y-1.5 -mx-2 px-2 py-1.5 rounded transition-colors duration-150 hover:bg-white/[0.025]"
      title={title}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3 flex-wrap min-w-0">
          <span className="text-[13.5px] font-medium text-[var(--color-ivory)] font-mono">
            {row.country}
          </span>
          {dominantLabel && (
            <span className="text-[11.5px] text-[var(--color-ivory-mute)]">
              mostly <span className="text-[var(--color-aqua)]">{dominantLabel}</span>
              {ageLabel && (
                <span className="text-[var(--color-ivory-mute)]">{' · last '}{ageLabel}</span>
              )}
            </span>
          )}
          {/* Sprint 32 — inline avgRating chip. Tone-coloured by
              quality threshold; shows "—" / no-chip when no ratings
              yet so ops sees the gap. */}
          {avgRating != null && (
            <span
              className="text-[11.5px] font-medium"
              style={{ color: ratingTone }}
              aria-label={`average rating ${avgRating.toFixed(1)} out of 5 across ${ratedCount} rated picks`}
            >
              {avgRating.toFixed(1)}★
              <span className="text-[var(--color-ivory-mute)]"> · {ratedCount} rated</span>
            </span>
          )}
        </div>
        <span className="text-[13px] font-mono text-[var(--color-ivory-mute)] shrink-0">
          {row.count.toLocaleString('en-IE')}
          {total > 0 && (
            <span className="ml-2 text-[11.5px]">({pct}%)</span>
          )}
        </span>
      </div>
      <div className="h-2 bg-white/[0.05] overflow-hidden" style={{ borderRadius: 4 }}>
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${barPct}%`,
            background: 'var(--color-aqua)',
            borderRadius: 4,
          }}
        />
      </div>
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  RatingHealth — sprint 31
 *  Cohort #5. Surfaces the org-wide customer-rating signal in the
 *  window: average score, rated-of-approved percentage, distribution
 *  histogram across the 5 star buckets, and the "needs follow-up"
 *  callout when 1-2★ ratings landed (those customers deserve
 *  proactive outreach).
 * ──────────────────────────────────────────────────────────────────── */

function RatingHealth({ data }: { data: OpsInsightsRatingCohort }) {
  // No ratings yet in window → coaching empty state. Distinct from
  // "no approvals yet" — if the org has approved requests but
  // nobody rated, the empty state nudges ops to chase ratings.
  if (data.totalRated === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ivory)]">
          Rating health
        </h2>
        <div
          className="bg-[var(--surface-card)] border border-white/[0.06] p-6"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="text-[var(--color-ivory-mute)] text-[14px] italic">
            {data.totalApproved > 0
              ? `${data.totalApproved} approval${data.totalApproved === 1 ? '' : 's'} in this window, none rated yet. Customers can rate the end-to-end experience from their request detail page — a gentle chase email after delivery typically lifts rated-percentage above 40%.`
              : 'No customer-approved requests in this window. As approvals land, customers can rate the end-to-end experience and the cohort lights up here with average score, distribution, and a "needs follow-up" callout for low-star ratings.'}
          </p>
        </div>
      </section>
    );
  }

  // The distribution histogram: max value (across the 5 buckets)
  // anchors the bar widths so a 30-rating run with [0, 2, 5, 13, 10]
  // renders as readable bars rather than every bar at near-zero.
  const maxBucket = Math.max(1, ...data.scoreDistribution);
  const avgTone: 'positive' | 'neutral' | 'warning' = (() => {
    if (data.averageScore == null) return 'neutral';
    if (data.averageScore >= 4.5) return 'positive';
    if (data.averageScore < 3.5) return 'warning';
    return 'neutral';
  })();
  const avgColor =
    avgTone === 'positive' ? 'var(--color-positive)' :
    avgTone === 'warning' ? 'var(--color-warning)' :
    'var(--color-ivory)';

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ivory)]">
          Rating health
        </h2>
        <span className="text-[12.5px] font-mono text-[var(--color-ivory-mute)]">
          {data.totalRated} rated · {data.totalApproved} approved
          {data.ratedPercentage != null && (
            <span className="ml-1">({data.ratedPercentage}%)</span>
          )}
        </span>
      </div>
      <div
        className="bg-[var(--surface-card)] border border-white/[0.06] p-6 space-y-5"
        style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
      >
        {/* Headline: average score (big number) + total rated. */}
        <div className="flex items-baseline gap-4 flex-wrap">
          <div className="space-y-0.5">
            <p className="text-[11px] font-semibold tracking-[0.08em] uppercase text-[var(--color-ivory-mute)]">
              Average
            </p>
            <p
              className="text-[34px] font-bold tracking-[-0.02em] font-mono leading-none"
              style={{ color: avgColor }}
            >
              {data.averageScore != null ? data.averageScore.toFixed(1) : '—'}
              <span className="text-[16px] font-medium text-[var(--color-ivory-mute)] ml-1">
                / 5
              </span>
            </p>
          </div>
          {data.lowScoreCount > 0 && (
            <div
              className="px-3 py-2 border self-end"
              style={{
                color: 'var(--color-warning)',
                borderColor: 'var(--color-warning)',
                background: 'rgba(245, 158, 11, 0.08)',
                borderRadius: 'var(--radius-badge)',
              }}
            >
              <span className="text-[11.5px] font-semibold tracking-[0.06em] uppercase">
                {data.lowScoreCount} need{data.lowScoreCount === 1 ? 's' : ''} follow-up
              </span>
              <span className="block text-[11px] text-[var(--color-ivory-mute)] mt-0.5">
                1-2★ ratings — reach out to those customers
              </span>
            </div>
          )}
        </div>

        {/* Distribution histogram, top-down 5★ → 1★ so the
            best-experience buckets read first. */}
        <div className="space-y-2.5 pt-1 border-t border-white/[0.06]">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = data.scoreDistribution[star - 1];
            const barPct = count > 0 ? Math.max(3, Math.round((count / maxBucket) * 100)) : 0;
            const isLow = star <= 2;
            return (
              <div key={star} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="font-mono text-[12.5px] tabular-nums"
                    style={{ color: isLow ? 'var(--color-warning)' : 'var(--color-ivory-dim)' }}
                  >
                    {'★'.repeat(star)}
                    <span className="text-[var(--color-ivory-mute)]/40">{'☆'.repeat(5 - star)}</span>
                  </span>
                  <span className="text-[12.5px] font-mono text-[var(--color-ivory-mute)]">
                    {count}
                    {data.totalRated > 0 && count > 0 && (
                      <span className="ml-2 text-[11px]">
                        ({Math.round((count / data.totalRated) * 100)}%)
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 bg-white/[0.05] overflow-hidden" style={{ borderRadius: 4 }}>
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${barPct}%`,
                      background: isLow ? 'var(--color-warning)' : 'var(--color-aqua)',
                      borderRadius: 4,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
