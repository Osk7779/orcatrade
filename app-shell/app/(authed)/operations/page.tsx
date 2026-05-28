'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, AuthError, type SavedPlan } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice, EmptyState } from '@/components/States';

function eur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

export default function OperationsPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [plans, setPlans] = useState<SavedPlan[]>([]);

  useEffect(() => {
    apiGet<{ ok: boolean; plans: SavedPlan[] }>('/plans')
      .then((d) => {
        setPlans(d.plans || []);
        setState('ready');
      })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  if (state === 'loading') return <LoadingNotice label="Loading operations…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to see your operations." />;
  if (state === 'error') return <ErrorNotice />;

  const withCost = plans.filter((p) => p.current?.perShipmentLandedTotal != null);
  const totalExposure = withCost.reduce(
    (s, p) => s + (p.current!.perShipmentLandedTotal || 0),
    0,
  );
  const totalDuty = withCost.reduce((s, p) => s + (p.current!.dutyEur || 0), 0);
  const maxLanded = Math.max(
    1,
    ...withCost.map((p) => p.current!.perShipmentLandedTotal || 0),
  );

  const drifted = plans
    .filter((p) => p.delta && p.delta.significant && p.delta.landedDeltaEur != null)
    .sort((a, b) => Math.abs(b.delta!.landedDeltaEur!) - Math.abs(a.delta!.landedDeltaEur!));
  const captured = drifted
    .filter((p) => (p.delta!.landedDeltaEur || 0) < 0)
    .reduce((s, p) => s + Math.abs(p.delta!.landedDeltaEur || 0), 0);

  const label = (p: SavedPlan) =>
    p.label || `${p.inputs?.originCountry || '?'} → ${p.inputs?.destinationCountry || '?'}`;

  const barColor = (p: SavedPlan) => {
    if (!p.delta?.significant) return 'var(--color-ivory-dim)';
    return (p.delta.landedDeltaPct ?? 0) >= 0
      ? 'var(--color-critical)'
      : 'var(--color-positive)';
  };

  const STATS: [string, string][] = [
    ['Landed exposure', eur(totalExposure)],
    ['Duty exposure', eur(totalDuty)],
    ['Plans tracked', String(plans.length)],
    ['Savings captured', eur(captured)],
  ];

  return (
    <div>
      <PageHeader
        kicker="Operations"
        title="Live exposure across your saved plans."
        sub="Recomputed against today's tariff, freight and FX. Drift is flagged the moment a number moves materially."
      />

      <div className="grid grid-cols-2 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] sm:grid-cols-4">
        {STATS.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-2 bg-[var(--color-ink)] p-5 md:p-6">
            <div
              className="font-serif text-[clamp(1.5rem,2.2vw+0.4rem,2rem)] leading-none tracking-[-0.022em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 550 }}
            >
              {v}
            </div>
            <div className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">{k}</div>
          </div>
        ))}
      </div>

      {/* Exposure by plan */}
      <section className="mt-12">
        <SectionHeader kicker="Exposure by plan">
          {withCost.length > 0 && (
            <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
              Bars: red = cost up since save · green = down · ivory = stable
            </span>
          )}
        </SectionHeader>
        {withCost.length === 0 ? (
          <EmptyState
            body="No saved plans yet."
            ctaLabel="Build one in the Import Plan Builder"
            ctaHref="/start/"
          />
        ) : (
          <div className="flex flex-col gap-3">
            {withCost
              .slice()
              .sort(
                (a, b) =>
                  (b.current!.perShipmentLandedTotal || 0) -
                  (a.current!.perShipmentLandedTotal || 0),
              )
              .map((p) => {
                const v = p.current!.perShipmentLandedTotal || 0;
                return (
                  <Link
                    key={p.id}
                    href={`/plans/${p.id}`}
                    className="group block bg-[var(--color-ink)] p-4 transition-colors duration-500 hover:bg-[var(--color-navy-soft)] md:p-5"
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="font-serif text-[14.5px] text-[var(--color-ivory)] group-hover:text-white">
                        {label(p)}
                      </span>
                      <span className="font-mono text-[13px] font-medium tabular-nums text-[var(--color-ivory)]">
                        {eur(v)}
                      </span>
                    </div>
                    <div className="h-[6px] bg-[var(--color-navy-line)]">
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${Math.max(3, (v / maxLanded) * 100)}%`,
                          background: barColor(p),
                        }}
                      />
                    </div>
                  </Link>
                );
              })}
          </div>
        )}
      </section>

      {/* Drift ledger */}
      <section className="mt-12">
        <SectionHeader kicker="Drift ledger" />
        {drifted.length === 0 ? (
          <p className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
            No material moves since you saved these plans.
          </p>
        ) : (
          <div className="border border-[var(--color-navy-line)]">
            {drifted.map((p, i) => {
              const up = (p.delta!.landedDeltaPct || 0) >= 0;
              return (
                <Link
                  key={p.id}
                  href={`/plans/${p.id}`}
                  className={`group flex items-center justify-between gap-3 px-5 py-4 transition-colors duration-500 hover:bg-[var(--color-navy-soft)] md:px-6 md:py-5 ${
                    i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
                  }`}
                >
                  <span className="font-serif text-[14.5px] text-[var(--color-ivory)]">
                    {label(p)}
                    {p.delta!.primaryDriver && (
                      <span className="ml-2 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                        · {p.delta!.primaryDriver}
                      </span>
                    )}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 font-mono text-[12.5px] font-medium tabular-nums ${
                      up ? 'text-[var(--color-critical)]' : 'text-[var(--color-positive)]'
                    }`}
                  >
                    {up ? '▲' : '▼'} {eur(Math.abs(p.delta!.landedDeltaEur || 0))} (
                    {Math.abs(p.delta!.landedDeltaPct || 0)}%)
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({
  kicker,
  children,
}: {
  kicker: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3 border-b border-[var(--color-navy-line)] pb-3">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden
          className="font-serif text-[12.5px] text-[var(--color-ivory-dim)]/60"
        >
          ❦
        </span>
        <span
          className="font-serif text-[1.05rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          {kicker}
        </span>
      </div>
      {children}
    </div>
  );
}
