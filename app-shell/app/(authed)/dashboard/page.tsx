'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet, AuthError, type Overview } from '@/lib/api';

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
  return (
    <div className="flex items-center gap-3">
      <span className="h-px w-8 bg-[var(--color-ivory-dim)]/40" />
      <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
        {children}
      </span>
    </div>
  );
}

function Headline({ children, size = 'lg' }: { children: React.ReactNode; size?: 'lg' | 'md' }) {
  const cls =
    size === 'lg'
      ? 'text-[clamp(2.6rem,4.2vw+0.4rem,3.8rem)] leading-[1.05]'
      : 'text-[clamp(1.6rem,2.4vw+0.4rem,2.2rem)] leading-[1.1]';
  return (
    <h1
      className={`font-serif ${cls} tracking-[-0.022em] text-[var(--color-ivory)] mt-5`}
      style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
    >
      {children}
    </h1>
  );
}

function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`flex flex-col ${className}`}>{children}</section>;
}

function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6 mb-7">
      <h2
        className="font-serif text-[1.6rem] tracking-[-0.018em] text-[var(--color-ivory)] leading-tight"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
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
      <Eyebrow>The cockpit · {new Date().toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'short' })}</Eyebrow>
      <Headline>
        {greeting()}{email ? ', ' : '.'}
        {email && (
          <span className="font-serif italic text-[var(--color-ivory-mute)]">
            {email.split('@')[0]}.
          </span>
        )}
      </Headline>
      <p className="mt-6 max-w-[60ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
        {summary.length
          ? `${summary.join(' · ')}. ${totalRouted > 0 ? `${eur(totalRouted)} of landed cost across your most recent plans.` : 'Everything you’ve modelled, in one place.'}`
          : 'Everything you’ve modelled, in one place. Build a plan to populate this view.'}
      </p>
      <div className="mt-8 flex items-center gap-3 font-mono text-[11px] tracking-[0.14em] uppercase text-[var(--color-ivory-mute)]">
        <span className="relative flex h-2 w-2 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-positive)] opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-positive)]" />
        </span>
        <span>Calculator-grounded · live · last refresh just now</span>
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
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--color-navy-line)] border border-[var(--color-navy-line)]">
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
      className="group relative isolate flex flex-col gap-3 bg-[var(--color-ink)] p-8 hover:bg-[var(--color-navy-soft)] transition-colors duration-500"
    >
      <span aria-hidden className="absolute top-0 left-0 h-[2px] w-0 bg-[var(--color-ivory)] transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
      <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-[var(--color-ivory-mute)]">
        {label}
      </div>
      <div
        className="font-serif text-[clamp(3rem,4vw+0.4rem,3.8rem)] leading-none tracking-[-0.028em]"
        style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 600, color: accent }}
      >
        {value}
      </div>
      <div className="font-serif italic text-[13px] text-[var(--color-ivory-mute)]">
        {hint}
      </div>
      <span className="inline-flex items-center gap-1.5 mt-auto font-mono text-[11px] tracking-[0.12em] uppercase text-[var(--color-ivory-dim)] group-hover:text-[var(--color-ivory)] transition-colors duration-300">
        View
        <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">→</span>
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
      <div className="relative isolate overflow-hidden border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/45 p-10 md:p-14">
        {/* Aurora wash */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(60% 80% at 0% 0%, ${tone.color}22, transparent 60%), radial-gradient(40% 60% at 100% 100%, rgba(96,165,250,0.08), transparent 60%)`,
          }}
        />
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-px w-8 bg-[var(--color-ivory-dim)]/40" />
          <span className="font-mono text-[10.5px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
            Next deadline
          </span>
          <span
            className="font-mono text-[10.5px] tracking-[0.12em] uppercase ml-auto px-2.5 py-1 border"
            style={{ color: tone.color, borderColor: tone.color + '55' }}
          >
            {tone.label}
          </span>
        </div>
        <h3
          className="mt-8 font-serif text-[clamp(1.9rem,3vw+0.4rem,2.8rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)] max-w-[28ch]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          {String(next.regime || '').toUpperCase()}
          <span className="font-serif italic text-[var(--color-ivory-mute)]"> — {next.title}</span>
        </h3>
        <div className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
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
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/calendar"
            className="group inline-flex items-center gap-2 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-white transition-colors duration-300"
          >
            Open the calendar
            <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">→</span>
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 border border-[var(--color-navy-line)] px-6 py-3 text-[12.5px] font-medium text-[var(--color-ivory)] hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)] transition-all duration-300"
          >
            Ask the agent
          </Link>
        </div>
      </div>
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
            className="group inline-flex items-center gap-2 text-[12.5px] font-medium text-[var(--color-ivory)]"
          >
            <span className="relative">
              See all plans
              <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/70 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
            </span>
            <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">→</span>
          </Link>
        }
      >
        Recent plans
      </SectionHeading>
      <div className="border border-[var(--color-navy-line)] divide-y divide-[var(--color-navy-line)]">
        {plans.map((p) => (
          <Link
            key={p.id}
            href="/plans"
            className="group flex items-center justify-between gap-4 px-6 py-5 hover:bg-[var(--color-navy-soft)]/45 transition-colors duration-300"
          >
            <div className="flex items-center gap-4 min-w-0">
              <span aria-hidden className="font-serif text-[20px] text-[var(--color-ivory-mute)]/55 leading-none">
                ▸
              </span>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="font-serif text-[16.5px] text-[var(--color-ivory)] truncate">
                  {p.label || p.route || p.id}
                </span>
                {p.route && p.label && (
                  <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-[var(--color-ivory-mute)] truncate">
                    {p.route}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-baseline gap-4 shrink-0">
              <span className="font-mono text-[15px] tabular-nums text-[var(--color-ivory)]">
                {eur(p.landedEur)}
              </span>
              <span aria-hidden className="font-mono text-[14px] text-[var(--color-ivory-mute)] transition-transform duration-500 group-hover:translate-x-0.5">
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--color-navy-line)] border border-[var(--color-navy-line)]">
        {ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group relative isolate flex flex-col gap-3 bg-[var(--color-ink)] p-7 hover:bg-[var(--color-navy-soft)] transition-colors duration-500"
          >
            <span aria-hidden className="absolute top-0 left-0 h-[2px] w-0 bg-[var(--color-ivory)] transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
            <div className="font-mono text-[10.5px] tracking-[0.16em] uppercase text-[var(--color-ivory-mute)]">
              {a.eyebrow}
            </div>
            <h3
              className="font-serif text-[1.35rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              {a.title}
            </h3>
            <p className="font-serif italic text-[14px] leading-[1.5] text-[var(--color-ivory-dim)]">
              {a.desc}
            </p>
            <span className="inline-flex items-center gap-1.5 mt-auto pt-3 font-mono text-[11px] tracking-[0.12em] uppercase text-[var(--color-ivory-dim)] group-hover:text-[var(--color-ivory)] transition-colors duration-300">
              Open
              <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">→</span>
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
