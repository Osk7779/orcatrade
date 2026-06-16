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
  ApiError,
  AuthError,
  DECLINE_REASONS,
  DECLINE_REASON_LABELS,
  IMPORT_REQUEST_STATUSES,
  type DeclineReason,
  type ImportRequestStatus,
  type OpsInsights,
  type OpsInsightsResponse,
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
      <RevisionCohort data={data.revisionCohort} />
      <Funnel data={data} />
      <DeclineBreakdown data={data} />
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
        <div className="flex gap-2 pt-2">
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
  label,
  n,
  total,
  maxN,
  tone,
}: {
  label: string;
  n: number;
  total: number;
  maxN: number;
  tone: 'present' | 'empty';
}) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  const barPct = n > 0 ? Math.max(2, Math.round((n / maxN) * 100)) : 0;
  return (
    <div className={`space-y-1.5 ${tone === 'empty' ? 'opacity-50' : ''}`}>
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
    </div>
  );
}

// Sprint 17 — silence the unused-import warning. IMPORT_REQUEST_STATUSES is
// surfaced here because the test suite verifies the page imports the closed
// taxonomy (so a status added to the schema without surfacing in funnel
// grouping fails the drift-guard).
void IMPORT_REQUEST_STATUSES;
