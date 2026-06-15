'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  apiGet,
  AuthError,
  type Overview,
  type ImportRequest,
  type ImportRequestStatus,
} from '@/lib/api';

function eur(n?: number) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

function greeting() {
  // Local time greeting — small touch that makes the cockpit feel
  // personal without the server having to know your timezone.
  const h = new Date().getHours();
  if (h < 5) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function urgencyTone(daysUntil?: number) {
  if (daysUntil == null) return { label: 'TBD', color: 'var(--color-ivory-mute)' };
  if (daysUntil < 0) return { label: 'Overdue', color: 'var(--color-critical)' };
  if (daysUntil <= 7) return { label: 'This week', color: 'var(--color-critical)' };
  if (daysUntil <= 30) return { label: 'This month', color: 'var(--color-warning)' };
  return { label: 'Upcoming', color: 'var(--color-positive)' };
}

export default function DashboardPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    apiGet<Overview>('/account/overview')
      .then((d) => { setData(d); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  const planCount = data?.plans?.count ?? 0;
  const portfolioCount = data?.portfolios?.count ?? 0;
  const complianceCount = data?.compliance?.count ?? 0;
  const next = data?.compliance?.next;
  const recentPlans = data?.plans?.recent ?? [];
  const totalRouted = useMemo(
    () => recentPlans.reduce((sum, p) => sum + (p.landedEur ?? 0), 0),
    [recentPlans],
  );

  if (state === 'loading') {
    return <DashboardSkeleton />;
  }

  if (state === 'auth') {
    return <AuthGate />;
  }

  if (state === 'error') {
    return (
      <Section>
        <Eyebrow>Dashboard</Eyebrow>
        <Headline>Couldn’t load your cockpit.</Headline>
        <p className="mt-4 text-[15px] text-[var(--color-ivory-dim)] max-w-prose">
          Something went wrong fetching your overview. The session is fine —
          this is on us. Refresh in a moment, or use the sidebar to navigate
          directly.
        </p>
      </Section>
    );
  }

  // Activation: brand-new accounts (no plans yet) get a guided first-run path.
  if (planCount === 0) {
    return <Activation email={data?.user?.email} />;
  }

  return (
    <div className="flex flex-col gap-16">
      <Hero
        email={data?.user?.email}
        planCount={planCount}
        portfolioCount={portfolioCount}
        complianceCount={complianceCount}
        totalRouted={totalRouted}
      />

      <Bento
        planCount={planCount}
        portfolioCount={portfolioCount}
        complianceCount={complianceCount}
      />

      <ImportsWidget />

      {next && <NextDeadline next={next} />}

      {recentPlans.length > 0 && <RecentPlans plans={recentPlans} />}

      <QuickActions />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Atoms
 * ──────────────────────────────────────────────────────────────────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
  // Sprint 11: Connectis-aligned eyebrow. Aqua semibold caption,
  // no decorative leading line — matches the imports surface.
  return (
    <span className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
      {children}
    </span>
  );
}

function Headline({ children, size = 'lg' }: { children: React.ReactNode; size?: 'lg' | 'md' }) {
  // Sprint 11: bold Inter display matching the imports hero. Inline
  // serif italic still reads as serif (font-serif on the inner span).
  const cls =
    size === 'lg'
      ? 'text-[clamp(2.25rem,4.5vw,3.25rem)] leading-[1.05]'
      : 'text-[clamp(1.6rem,2.4vw+0.4rem,2.2rem)] leading-[1.1]';
  return (
    <h1
      className={`${cls} font-bold tracking-[-0.025em] text-[var(--color-ivory)] mt-4`}
    >
      {children}
    </h1>
  );
}

function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`flex flex-col ${className}`}>{children}</section>;
}

function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  // Sprint 11: Inter semibold instead of Fraunces serif.
  return (
    <div className="flex items-end justify-between gap-6 mb-5">
      <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-ivory)]">
        {children}
      </h2>
      {action}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Hero
 * ──────────────────────────────────────────────────────────────────── */

function Hero({
  email,
  planCount,
  portfolioCount,
  complianceCount,
  totalRouted,
}: {
  email?: string;
  planCount: number;
  portfolioCount: number;
  complianceCount: number;
  totalRouted: number;
}) {
  const summary: string[] = [];
  if (planCount) summary.push(`${planCount} plan${planCount === 1 ? '' : 's'}`);
  if (portfolioCount) summary.push(`${portfolioCount} portfolio${portfolioCount === 1 ? '' : 's'}`);
  if (complianceCount) summary.push(`${complianceCount} open item${complianceCount === 1 ? '' : 's'}`);

  return (
    <Section>
      <div className="relative">
        <div
          aria-hidden
          className="absolute -top-8 -right-8 w-64 h-64 pointer-events-none rounded-full"
          style={{
            background: 'radial-gradient(closest-side, var(--color-aqua-glow), transparent)',
            filter: 'blur(8px)',
          }}
        />
        <div className="relative space-y-1">
          <Eyebrow>The cockpit · {new Date().toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'short' })}</Eyebrow>
          <Headline>
            {greeting()}{email ? ', ' : '.'}
            {email && (
              <span className="font-serif italic text-[var(--color-ivory-mute)]">
                {email.split('@')[0]}.
              </span>
            )}
          </Headline>
        </div>
      </div>
      <p className="mt-5 max-w-[60ch] text-[16px] leading-relaxed text-[var(--color-ivory-dim)]">
        {summary.length
          ? `${summary.join(' · ')}. ${totalRouted > 0 ? `${eur(totalRouted)} of landed cost across your most recent plans.` : 'Everything you have modelled, in one place.'}`
          : 'Everything you have modelled, in one place. Build a plan to populate this view.'}
      </p>
      <div className="mt-7 flex items-center gap-3 text-[12px] text-[var(--color-ivory-mute)]">
        <span className="relative flex h-2 w-2 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-aqua)] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-aqua)]" />
        </span>
        <span className="font-serif italic">Calculator-grounded · live · last refresh just now</span>
      </div>
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Stat bento — three editorial cards
 * ──────────────────────────────────────────────────────────────────── */

function Bento({
  planCount,
  portfolioCount,
  complianceCount,
}: {
  planCount: number;
  portfolioCount: number;
  complianceCount: number;
}) {
  // Sprint 11: rounded soft-shadow cards in a true grid (gap, not
  // 1px pseudo-border). Matches the imports surface card rhythm.
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Stat
        label="Saved plans"
        value={planCount}
        hint="Reusable across portfolios"
        href="/plans"
      />
      <Stat
        label="Active portfolios"
        value={portfolioCount}
        hint="Monitored for tariff + regime drift"
        href="/portfolios"
      />
      <Stat
        label="Open compliance items"
        value={complianceCount}
        hint={complianceCount > 0 ? 'On the calendar' : 'No deadlines outstanding'}
        href="/calendar"
        tone={complianceCount > 0 ? 'warning' : 'positive'}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  href: string;
  tone?: 'warning' | 'positive';
}) {
  const accent =
    tone === 'warning' ? 'var(--color-warning)' :
    tone === 'positive' ? 'var(--color-positive)' :
    'var(--color-ivory)';
  return (
    <Link
      href={href}
      className="group relative isolate flex flex-col gap-3 bg-[var(--surface-card)] border border-white/[0.06] p-7 transition-all duration-300 hover:border-[var(--color-aqua)]/30 hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-px"
      style={{
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-ivory-mute)]">
        {label}
      </div>
      <div
        className="text-[clamp(3rem,4vw+0.4rem,3.8rem)] font-bold leading-none tabular-nums tracking-[-0.02em]"
        style={{ color: accent }}
      >
        {value}
      </div>
      <div className="font-serif italic text-[13px] text-[var(--color-ivory-mute)]">
        {hint}
      </div>
      <span className="inline-flex items-center gap-1.5 mt-auto text-[12px] font-medium text-[var(--color-ivory-dim)] group-hover:text-[var(--color-aqua)] transition-colors duration-200">
        View
        <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
      </span>
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Next deadline — flagship callout
 * ──────────────────────────────────────────────────────────────────── */

function NextDeadline({ next }: { next: NonNullable<Overview['compliance']>['next'] }) {
  if (!next) return null;
  const tone = urgencyTone(next.daysUntil);
  return (
    <Section>
      <div
        className="relative isolate overflow-hidden border border-white/[0.06] bg-[var(--surface-card)] p-8 md:p-12"
        style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
      >
        {/* Aurora wash — tone-coded so the overdue / this-week states
            read at a glance even before the chip is read. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(60% 80% at 0% 0%, ${tone.color}1f, transparent 60%), radial-gradient(40% 60% at 100% 100%, var(--color-aqua-glow), transparent 60%)`,
          }}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
            Next deadline
          </span>
          <span
            className="text-[11px] font-medium uppercase ml-auto px-3 py-1 border"
            style={{
              color: tone.color,
              borderColor: tone.color + '66',
              background: tone.color + '10',
              borderRadius: 'var(--radius-badge)',
            }}
          >
            {tone.label}
          </span>
        </div>
        <h3 className="mt-6 text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)] max-w-[28ch]">
          {String(next.regime || '').toUpperCase()}
          <span className="font-serif italic font-normal text-[var(--color-ivory-mute)]"> — {next.title}</span>
        </h3>
        <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div className="font-mono text-[14px] tracking-tight text-[var(--color-ivory)]">
            Due {next.dueDate}
          </div>
          {typeof next.daysUntil === 'number' && (
            <div className="font-serif italic text-[15px] text-[var(--color-ivory-dim)]">
              {next.daysUntil < 0
                ? `${Math.abs(next.daysUntil)} day${Math.abs(next.daysUntil) === 1 ? '' : 's'} overdue`
                : next.daysUntil === 0
                ? 'today'
                : `${next.daysUntil} day${next.daysUntil === 1 ? '' : 's'} away`}
            </div>
          )}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/calendar"
            className="group inline-flex items-center gap-2 px-6 py-3 text-[13.5px] font-semibold bg-[var(--color-aqua)] text-[var(--color-navy)] transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px"
            style={{
              borderRadius: 'var(--radius-button)',
              boxShadow: 'var(--shadow-cta)',
            }}
          >
            Open the calendar
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 border border-white/[0.12] px-6 py-3 text-[13.5px] font-medium text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] hover:border-white/[0.25] hover:bg-white/[0.025] transition-all duration-200"
            style={{ borderRadius: 'var(--radius-button)' }}
          >
            Ask the agent
          </Link>
        </div>
      </div>
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Imports widget — sprint 12 ch 1
 *
 *  Fetches the customer's recent import requests via /api/imports?mine=1
 *  and renders them inline on the dashboard so they don't need to
 *  click through to /imports to see operational status.
 * ──────────────────────────────────────────────────────────────────── */

function importStatusTone(s: ImportRequestStatus): string {
  if (s === 'failed' || s === 'cancelled' || s === 'customer_rejected') return 'var(--color-critical)';
  if (s === 'customer_approved') return 'var(--color-positive)';
  if (s === 'awaiting_review' || s === 'processing') return 'var(--color-warning)';
  if (s === 'quoted') return 'var(--color-aqua)';
  return 'var(--color-ivory-mute)';
}

function importStatusLabel(s: ImportRequestStatus): string {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function importAgeLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  const mins = Math.floor(ms / 60_000);
  return mins >= 1 ? `${mins}m ago` : 'just now';
}

function ImportsWidget() {
  type ListState = 'loading' | 'auth' | 'error' | 'empty' | 'ready';
  const [state, setState] = useState<ListState>('loading');
  const [items, setItems] = useState<ImportRequest[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; importRequests: ImportRequest[] }>('/imports?mine=1&limit=5')
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d.importRequests) ? d.importRequests : [];
        setItems(list);
        setState(list.length === 0 ? 'empty' : 'ready');
      })
      .catch((err) => {
        if (cancelled) return;
        // /api/imports requires Postgres (sprint 1). On a fresh deploy
        // without the schema migration applied the endpoint returns
        // 503; on auth failure 401. Neither should break the dashboard
        // — silently hide the widget. The customer sees their other
        // widgets and we don't fall back to a noisy error.
        if (err instanceof AuthError) setState('auth');
        else setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hide entirely on auth / error so the dashboard never breaks because
  // /api/imports is in a degraded state (e.g. schema-012 not yet applied).
  if (state === 'auth' || state === 'error') return null;

  return (
    <Section>
      <SectionHeading
        action={
          <Link
            href="/imports"
            className="group inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--color-aqua)] hover:underline"
          >
            See all imports
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
        }
      >
        Your imports
      </SectionHeading>

      {state === 'loading' && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] p-8"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <p className="text-[var(--color-ivory-mute)] text-sm">Loading…</p>
        </div>
      )}

      {state === 'empty' && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] p-10 text-center"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">No imports yet.</p>
          <p className="text-[var(--color-ivory-mute)] text-[14px] mt-3 max-w-md mx-auto leading-relaxed">
            Tell us what you want from Asia and we will build a factory shortlist + landed-cost quote.
          </p>
          <Link
            href="/imports/new"
            className="group inline-flex items-center gap-2 mt-6 px-5 py-2.5 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[13.5px] font-semibold transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px"
            style={{
              borderRadius: 'var(--radius-button)',
              boxShadow: 'var(--shadow-cta)',
            }}
          >
            New import request
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      )}

      {state === 'ready' && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] overflow-hidden"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          {items.map((r, i) => {
            const tone = importStatusTone(r.status);
            const landed = r.landedQuote && Number.isFinite(r.landedQuote.totalLandedCents)
              ? '€' + Math.round(r.landedQuote.totalLandedCents / 100).toLocaleString('en-IE')
              : null;
            return (
              <Link
                key={r.externalId}
                href={`/imports/${r.externalId}`}
                className={`group flex items-start justify-between gap-4 px-6 py-4 hover:bg-white/[0.025] transition-colors duration-200 ${
                  i > 0 ? 'border-t border-white/[0.04]' : ''
                }`}
              >
                <div className="flex flex-col gap-1 min-w-0 flex-1">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-[15px] font-medium text-[var(--color-ivory)] truncate group-hover:text-[var(--color-aqua)] transition-colors">
                      {r.label}
                    </span>
                    <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--color-ivory-mute)]/70">
                      {r.externalId}
                    </span>
                  </div>
                  <span className="text-[13px] text-[var(--color-ivory-dim)] line-clamp-1">
                    {r.productDescription}
                  </span>
                  <div className="flex items-center gap-3 text-[11.5px] text-[var(--color-ivory-mute)]">
                    <span className="inline-flex items-center gap-1.5" style={{ color: tone }}>
                      <span
                        aria-hidden
                        className="inline-block w-1.5 h-1.5"
                        style={{ background: tone, borderRadius: '999px' }}
                      />
                      {importStatusLabel(r.status)}
                    </span>
                    <span>·</span>
                    <span>{importAgeLabel(r.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {landed && (
                    <span className="font-mono text-[14px] tabular-nums font-medium text-[var(--color-ivory)]">
                      {landed}
                    </span>
                  )}
                  <span aria-hidden className="text-[14px] text-[var(--color-ivory-mute)] transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Recent plans
 * ──────────────────────────────────────────────────────────────────── */

function RecentPlans({ plans }: { plans: NonNullable<NonNullable<Overview['plans']>['recent']> }) {
  return (
    <Section>
      <SectionHeading
        action={
          <Link
            href="/plans"
            className="group inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--color-aqua)] hover:underline"
          >
            See all plans
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
        }
      >
        Recent plans
      </SectionHeading>
      <div
        className="border border-white/[0.06] bg-[var(--surface-card)] overflow-hidden"
        style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
      >
        {plans.map((p, i) => (
          <Link
            key={p.id}
            href="/plans"
            className={`group flex items-center justify-between gap-4 px-6 py-4 hover:bg-white/[0.025] transition-colors duration-200 ${
              i > 0 ? 'border-t border-white/[0.04]' : ''
            }`}
          >
            <div className="flex items-center gap-4 min-w-0">
              <span aria-hidden className="text-[14px] text-[var(--color-aqua)]/60 leading-none">
                ▸
              </span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[15px] font-medium text-[var(--color-ivory)] truncate group-hover:text-[var(--color-aqua)] transition-colors">
                  {p.label || p.route || p.id}
                </span>
                {p.route && p.label && (
                  <span className="font-mono text-[11px] tracking-[0.05em] text-[var(--color-ivory-mute)] truncate">
                    {p.route}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-baseline gap-4 shrink-0">
              <span className="font-mono text-[14px] tabular-nums font-medium text-[var(--color-ivory)]">
                {eur(p.landedEur)}
              </span>
              <span aria-hidden className="text-[14px] text-[var(--color-ivory-mute)] transition-transform duration-200 group-hover:translate-x-0.5">
                →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Quick actions
 * ──────────────────────────────────────────────────────────────────── */

const ACTIONS = [
  {
    title: 'Build a plan',
    desc: 'Landed cost, duty, CBAM/EUDR, FX — modelled in one wizard.',
    href: '/start/',
    eyebrow: 'Wizard',
  },
  {
    title: 'Ask the agent',
    desc: 'Calculator-grounded answers across customs, logistics, sourcing & finance.',
    href: '/chat',
    eyebrow: 'Orchestrator',
  },
  {
    title: 'Open monitoring',
    desc: 'Watch tariff and regime drift on every portfolio you’ve saved.',
    href: '/alerts',
    eyebrow: 'Alerts',
  },
];

function QuickActions() {
  return (
    <Section>
      <SectionHeading>Quick actions</SectionHeading>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group relative isolate flex flex-col gap-3 bg-[var(--surface-card)] border border-white/[0.06] p-7 transition-all duration-300 hover:border-[var(--color-aqua)]/30 hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-px"
            style={{
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div className="text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
              {a.eyebrow}
            </div>
            <h3 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--color-ivory)]">
              {a.title}
            </h3>
            <p className="text-[14px] leading-relaxed text-[var(--color-ivory-dim)]">
              {a.desc}
            </p>
            <span className="inline-flex items-center gap-1.5 mt-auto pt-3 text-[12px] font-medium text-[var(--color-ivory-dim)] group-hover:text-[var(--color-aqua)] transition-colors duration-200">
              Open
              <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Activation (zero-state: brand-new account)
 * ──────────────────────────────────────────────────────────────────── */

function Activation({ email }: { email?: string }) {
  const steps = [
    { n: '01', t: 'Build your first import plan', d: 'Landed cost, duty, CBAM/EUDR, FX — in one wizard.', href: '/start/', cta: 'Open the builder' },
    { n: '02', t: 'Ask the agent about your imports', d: 'Calculator-grounded answers across customs, logistics, sourcing & finance.', href: '/chat', cta: 'Ask the agent' },
    { n: '03', t: 'Invite your team', d: 'Add colleagues with roles — analyst, finance, compliance, viewer.', href: '/team', cta: 'Manage team' },
  ];
  return (
    <div className="flex flex-col gap-14">
      <Section>
        <Eyebrow>Get started · {email}</Eyebrow>
        <Headline>Welcome to OrcaTrade.</Headline>
        <p className="mt-6 max-w-[60ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
          Three steps to your first calculator-grounded import quote.
          You can come back here any time — the cockpit grows with the
          plans you save and the portfolios you put under monitoring.
        </p>
      </Section>

      <div className="border border-[var(--color-navy-line)] divide-y divide-[var(--color-navy-line)]">
        {steps.map((s) => (
          <Link
            key={s.n}
            href={s.href}
            className="group flex items-center gap-6 px-7 py-7 hover:bg-[var(--color-navy-soft)]/45 transition-colors duration-300"
          >
            <span
              className="font-serif text-[2rem] leading-none text-[var(--color-ivory-mute)] tabular-nums shrink-0"
              style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 500 }}
            >
              {s.n}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-serif text-[18px] leading-tight text-[var(--color-ivory)]">
                {s.t}
              </div>
              <div className="mt-1 font-serif italic text-[13.5px] text-[var(--color-ivory-mute)]">
                {s.d}
              </div>
            </div>
            <span className="shrink-0 inline-flex items-center gap-2 text-[12.5px] font-medium text-[var(--color-ivory)]">
              <span className="relative">
                {s.cta}
                <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/70 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
              </span>
              <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Auth gate
 * ──────────────────────────────────────────────────────────────────── */

function AuthGate() {
  return (
    <Section>
      <Eyebrow>Sign in</Eyebrow>
      <Headline>Your cockpit is one click away.</Headline>
      <p className="mt-6 max-w-[55ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
        Plans, monitoring alerts and compliance deadlines live in your
        signed-in account. Use the magic-link sign-in to continue —
        nothing is created until you click the email.
      </p>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <Link
          href="/signin?return=%2Fapp%2Fdashboard"
          className="group inline-flex items-center gap-2 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-white transition-colors duration-300"
        >
          Sign in
          <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">→</span>
        </Link>
        <Link
          href="/signup?return=%2Fapp%2Fdashboard"
          className="group inline-flex items-center gap-2 border border-[var(--color-navy-line)] px-7 py-3.5 text-[12.5px] font-medium text-[var(--color-ivory)] hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)] transition-all duration-300"
        >
          Create an account
        </Link>
      </div>
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────
 *  Skeleton (loading state)
 * ──────────────────────────────────────────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-14 animate-pulse">
      <Section>
        <Eyebrow>The cockpit</Eyebrow>
        <div className="mt-5 h-12 w-[60%] bg-[var(--color-navy-soft)]/60" />
        <div className="mt-6 h-4 w-[50%] bg-[var(--color-navy-soft)]/45" />
        <div className="mt-2 h-4 w-[40%] bg-[var(--color-navy-soft)]/45" />
      </Section>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--color-navy-line)] border border-[var(--color-navy-line)]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-[var(--color-ink)] p-8 h-[180px]">
            <div className="h-3 w-24 bg-[var(--color-navy-soft)]/60" />
            <div className="mt-5 h-12 w-16 bg-[var(--color-navy-soft)]/60" />
            <div className="mt-3 h-3 w-32 bg-[var(--color-navy-soft)]/45" />
          </div>
        ))}
      </div>
    </div>
  );
}
