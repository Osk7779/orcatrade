'use client';

import { useEffect, useState } from 'react';
import { apiGet, AuthError, type Overview } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';

function eur(n?: number) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

export default function DashboardPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    apiGet<Overview>('/account/overview')
      .then((d) => {
        setData(d);
        setState('ready');
      })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  if (state === 'loading') {
    return (
      <div className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
        Loading your cockpit…
      </div>
    );
  }

  if (state === 'auth') {
    return (
      <div className="max-w-[480px]">
        <PageHeader
          kicker="Sign in required"
          title="Sign in to OrcaTrade Group."
          sub="Your plans, monitoring alerts and compliance deadlines live here. Sign in with a magic link to continue."
        />
        <a
          href="/account/"
          className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
        >
          Sign in
          <span
            aria-hidden
            className="transition-transform duration-500 group-hover:translate-x-0.5"
          >
            →
          </span>
        </a>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-5">
        <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">
          Could not load your dashboard. Please retry shortly.
        </p>
      </div>
    );
  }

  const o = data || {};
  const next = o.compliance?.next;
  const planCount = o.plans?.count ?? 0;

  // Activation: brand-new accounts get a guided first-run path.
  if (planCount === 0) {
    const STEPS = [
      {
        n: 'I',
        title: 'Build your first import plan.',
        body: 'Landed cost, duty, CBAM/EUDR, FX — in one calculator-grounded wizard.',
        href: '/start/',
        cta: 'Open the builder',
      },
      {
        n: 'II',
        title: 'Ask the agent about your imports.',
        body: 'Calculator-grounded answers across customs, logistics, sourcing and finance.',
        href: '/chat',
        cta: 'Ask the agent',
      },
      {
        n: 'III',
        title: 'Invite your team.',
        body: 'Add colleagues with roles — analyst, finance, compliance, viewer.',
        href: '/team',
        cta: 'Manage team',
      },
    ];
    return (
      <div className="max-w-[760px]">
        <PageHeader
          kicker="Get started"
          title="Welcome to OrcaTrade Group."
          sub={`${o.user?.email ?? ''} — three steps to your first calculator-grounded import quote.`}
        />
        <ol className="flex flex-col gap-px bg-[var(--color-navy-line)] border border-[var(--color-navy-line)]">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="group flex flex-col gap-4 bg-[var(--color-ink)] p-6 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:flex-row md:items-center md:gap-8 md:p-8"
            >
              <span
                className="font-serif text-[1.6rem] italic leading-none text-[var(--color-ivory)]"
                style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
              >
                § {s.n}
              </span>
              <div className="flex-1">
                <h2
                  className="font-serif text-[1.2rem] leading-tight tracking-[-0.016em] text-[var(--color-ivory)]"
                  style={{
                    fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                    fontWeight: 550,
                  }}
                >
                  {s.title}
                </h2>
                <p className="mt-2 max-w-[58ch] text-[14px] leading-[1.65] text-[var(--color-ivory-dim)]">
                  {s.body}
                </p>
              </div>
              <a
                href={s.href}
                className="group/cta inline-flex items-center gap-2 self-start border border-[var(--color-ivory-dim)]/35 px-5 py-2.5 text-[12px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)] md:self-center"
              >
                {s.cta}
                <span
                  aria-hidden
                  className="transition-transform duration-500 group-hover/cta:translate-x-0.5"
                >
                  →
                </span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        kicker="Dashboard"
        title="Welcome back."
        meta={o.user?.email ?? undefined}
      />

      {/* Stat plate */}
      <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] sm:grid-cols-3">
        <Stat label="Saved plans" value={String(o.plans?.count ?? 0)} />
        <Stat label="Portfolios" value={String(o.portfolios?.count ?? 0)} />
        <Stat
          label="Open compliance items"
          value={String(o.compliance?.count ?? 0)}
        />
      </div>

      {next && (
        <section className="mt-10 border border-[var(--color-navy-line)] bg-[var(--color-navy)]/30 p-6 md:p-8">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="font-serif text-[12.5px] text-[var(--color-ivory-dim)]/60"
            >
              ❦
            </span>
            <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
              Next deadline
            </span>
          </div>
          <div
            className="mt-3 font-serif text-[1.4rem] leading-tight tracking-[-0.016em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
          >
            <span className="font-mono text-[12px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
              {String(next.regime || '').toUpperCase()}
            </span>
            <span className="mx-3 text-[var(--color-navy-line)]">·</span>
            {next.title}
          </div>
          <div className="mt-2 font-serif text-[13.5px] italic text-[var(--color-ivory-dim)]">
            Due {next.dueDate}
            {typeof next.daysUntil === 'number'
              ? ` · ${next.daysUntil} day${next.daysUntil === 1 ? '' : 's'} away`
              : ''}
          </div>
        </section>
      )}

      {!!o.plans?.recent?.length && (
        <section className="mt-12">
          <div className="mb-5 flex items-center gap-3">
            <span
              aria-hidden
              className="font-serif text-[12.5px] text-[var(--color-ivory-dim)]/60"
            >
              ❦
            </span>
            <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
              Recent plans
            </span>
          </div>
          <div className="border border-[var(--color-navy-line)]">
            {o.plans.recent.map((p, i) => (
              <a
                key={p.id}
                href="/account/plans/"
                className={`group flex items-center justify-between gap-4 px-5 py-4 transition-colors duration-500 hover:bg-[var(--color-navy-soft)] md:px-6 md:py-5 ${
                  i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
                }`}
              >
                <span className="font-serif text-[15px] leading-tight text-[var(--color-ivory)]">
                  {p.label || p.route || p.id}
                </span>
                <span className="font-mono text-[13.5px] font-medium tabular-nums text-[var(--color-ivory-dim)]">
                  {eur(p.landedEur)}
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-3 bg-[var(--color-ink)] p-6 md:p-8">
      <div
        className="font-serif text-[clamp(2.2rem,3vw+0.4rem,2.8rem)] leading-none tracking-[-0.024em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 550 }}
      >
        {value}
      </div>
      <div className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
        {label}
      </div>
    </div>
  );
}
