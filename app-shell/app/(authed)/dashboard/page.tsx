'use client';

import { useEffect, useState } from 'react';
import { apiGet, AuthError, type Overview } from '@/lib/api';

function eur(n?: number) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

export default function DashboardPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    apiGet<Overview>('/account/overview')
      .then((d) => { setData(d); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading your cockpit…</p>;

  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to OrcaTrade</h1>
        <p className="text-white/70 text-sm leading-relaxed mb-5">
          Your plans, monitoring alerts and compliance deadlines live here. Sign in with a magic link to continue.
        </p>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">
          Sign in →
        </a>
      </div>
    );
  }

  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load your dashboard. Please retry shortly.</p>;

  const o = data || {};
  const next = o.compliance?.next;
  const planCount = o.plans?.count ?? 0;

  // Activation: brand-new accounts (no plans yet) get a guided first-run path
  // to the aha-moment instead of a wall of zeroes.
  if (planCount === 0) {
    return (
      <div className="max-w-xl">
        <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Get started</div>
        <h1 className="text-4xl mb-2">Welcome to OrcaTrade</h1>
        <p className="text-white/65 text-sm mb-8">{o.user?.email} — three steps to your first grounded import quote.</p>
        <ol className="space-y-3">
          {[
            { n: 1, t: 'Build your first import plan', d: 'Landed cost, duty, CBAM/EUDR, FX — in one wizard.', href: '/start/', cta: 'Open the builder' },
            { n: 2, t: 'Ask the agent about your imports', d: 'Calculator-grounded answers across customs, logistics, sourcing & finance.', href: '/chat', cta: 'Ask the agent' },
            { n: 3, t: 'Invite your team', d: 'Add colleagues with roles — analyst, finance, compliance, viewer.', href: '/team', cta: 'Manage team' },
          ].map((s) => (
            <li key={s.n} className="border border-[var(--color-line)] px-5 py-4 flex items-start gap-4">
              <span className="font-serif text-2xl text-[var(--color-accent-soft)] leading-none mt-0.5">{s.n}</span>
              <div className="flex-1">
                <div className="text-ivory text-sm font-medium">{s.t}</div>
                <div className="text-white/55 text-xs mt-0.5">{s.d}</div>
              </div>
              <a href={s.href} className="shrink-0 px-3 py-1.5 text-xs font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm self-center">{s.cta} →</a>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div>
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Dashboard</div>
      <h1 className="text-4xl mb-1">Welcome back</h1>
      <p className="text-white/60 text-sm mb-8">{o.user?.email}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <Stat label="Saved plans" value={String(o.plans?.count ?? 0)} />
        <Stat label="Portfolios" value={String(o.portfolios?.count ?? 0)} />
        <Stat label="Open compliance items" value={String(o.compliance?.count ?? 0)} />
      </div>

      {next && (
        <div className="border-l-2 border-[var(--color-accent)] bg-white/[0.03] px-5 py-4 mb-10">
          <div className="text-[0.7rem] uppercase tracking-wider text-white/50 mb-1">Next deadline</div>
          <div className="text-lg font-serif">
            {String(next.regime || '').toUpperCase()} — {next.title}
          </div>
          <div className="text-white/60 text-sm mt-1">
            Due {next.dueDate}{typeof next.daysUntil === 'number' ? ` · ${next.daysUntil} day(s) away` : ''}
          </div>
        </div>
      )}

      {!!o.plans?.recent?.length && (
        <section>
          <h2 className="text-xl mb-3">Recent plans</h2>
          <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
            {o.plans.recent.map((p) => (
              <a key={p.id} href="/account/plans/" className="flex justify-between items-center px-4 py-3 hover:bg-white/[0.03]">
                <span className="text-sm text-white/85">{p.label || p.route || p.id}</span>
                <span className="font-mono text-sm text-white/60">{eur(p.landedEur)}</span>
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
    <div className="border border-[var(--color-line)] border-t-2 border-t-[var(--color-accent)] px-4 py-4">
      <div className="font-serif text-3xl font-semibold text-ivory">{value}</div>
      <div className="text-[0.72rem] uppercase tracking-wider text-white/50 mt-1">{label}</div>
    </div>
  );
}
