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

function DriftBadge({ delta }: { delta?: SavedPlan['delta'] }) {
  if (!delta || !delta.significant || delta.landedDeltaPct == null) return null;
  const up = (delta.landedDeltaPct ?? 0) >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[10.5px] font-medium tabular-nums ${
        up
          ? 'bg-[var(--color-critical)]/12 text-[var(--color-critical)]'
          : 'bg-[var(--color-positive)]/12 text-[var(--color-positive)]'
      }`}
      title={`${eur(delta.landedDeltaEur)} since saved${
        delta.primaryDriver ? ` · mostly ${delta.primaryDriver}` : ''
      }`}
    >
      {up ? '▲' : '▼'} {Math.abs(delta.landedDeltaPct)}%
    </span>
  );
}

function ReproBadge({ p }: { p: SavedPlan }) {
  if (p.reproducible == null) return null;
  if (p.reproducible) {
    return (
      <span
        className="inline-flex items-center gap-1 bg-[var(--color-positive)]/12 px-2 py-0.5 font-mono text-[10.5px] font-medium text-[var(--color-positive)]"
        title="Reproducible — market data unchanged since you saved this plan"
      >
        ✓ reproducible
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 bg-[var(--color-warning)]/12 px-2 py-0.5 font-mono text-[10.5px] font-medium text-[var(--color-warning)]"
      title="Market data has drifted; the original euros are still recoverable from the stored snapshot."
    >
      ◆ drifted
    </span>
  );
}

export default function PlansPage() {
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

  if (state === 'loading') return <LoadingNotice label="Loading your plans…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to see your plans." />;
  if (state === 'error') return <ErrorNotice />;

  return (
    <div>
      <PageHeader
        kicker="Plans"
        title="Saved import plans."
        sub="Recomputed against today's tariff, freight and FX data. A ▲/▼ badge marks plans whose landed cost has moved ≥5% since you saved them; ✓ / ◆ marks reproducibility against the stored data snapshot."
        actions={
          <Link
            href="/start/"
            className="group inline-flex items-center gap-2 bg-[var(--color-ivory)] px-5 py-2.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
          >
            + New plan
            <span
              aria-hidden
              className="transition-transform duration-500 group-hover:translate-x-0.5"
            >
              →
            </span>
          </Link>
        }
      />

      {!plans.length ? (
        <EmptyState
          body="You have not saved any import plans yet."
          ctaLabel="Build your first plan"
          ctaHref="/start/"
        />
      ) : (
        <div className="border border-[var(--color-navy-line)]">
          {plans.map((p, i) => {
            const landed =
              p.current?.perShipmentLandedTotal ?? p.snapshot?.perShipmentLandedTotal;
            const inp = p.inputs || {};
            return (
              <Link
                key={p.id}
                href={`/plans/${p.id}`}
                className={`group flex flex-col gap-3 px-5 py-4 transition-colors duration-500 hover:bg-[var(--color-navy-soft)] md:flex-row md:items-center md:justify-between md:px-6 md:py-5 ${
                  i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className="truncate font-serif text-[1.05rem] leading-tight text-[var(--color-ivory)]"
                      style={{
                        fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                        fontWeight: 550,
                      }}
                    >
                      {p.label || inp.productCategory || p.id}
                    </span>
                    <DriftBadge delta={p.delta} />
                    <ReproBadge p={p} />
                  </div>
                  <div className="mt-1.5 font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
                    {inp.originCountry || '?'} → {inp.destinationCountry || '?'}
                    {inp.hsCode ? ` · HS ${inp.hsCode}` : ''}
                    {p.savedAt ? ` · saved ${String(p.savedAt).slice(0, 10)}` : ''}
                  </div>
                </div>
                <div className="flex flex-row items-baseline gap-3 md:flex-col md:items-end md:gap-0.5">
                  <div className="font-mono text-[14px] font-medium tabular-nums text-[var(--color-ivory)]">
                    {eur(landed)}
                  </div>
                  <div className="font-serif text-[11.5px] italic text-[var(--color-ivory-mute)]">
                    landed / shipment
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
