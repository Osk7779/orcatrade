'use client';

import { useEffect, useState } from 'react';
import { apiGet, AuthError, type SavedPortfolio } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice, EmptyState } from '@/components/States';

function eur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

export default function PortfoliosPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [items, setItems] = useState<SavedPortfolio[]>([]);

  useEffect(() => {
    apiGet<{ ok: boolean; portfolios: SavedPortfolio[] }>('/portfolio/list')
      .then((d) => {
        setItems(d.portfolios || []);
        setState('ready');
      })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  if (state === 'loading') return <LoadingNotice label="Loading your portfolios…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to see your portfolios." />;
  if (state === 'error') return <ErrorNotice />;

  return (
    <div>
      <PageHeader
        kicker="Portfolios"
        title="Multi-SKU portfolios."
        sub="Bundle several SKUs into one landed-cost view. Blended duty, consolidation savings and totals priced end-to-end against today's data."
        actions={
          <a
            href="/start/"
            className="group inline-flex items-center gap-2 bg-[var(--color-ivory)] px-5 py-2.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
          >
            + New portfolio
            <span
              aria-hidden
              className="transition-transform duration-500 group-hover:translate-x-0.5"
            >
              →
            </span>
          </a>
        }
      />

      {!items.length ? (
        <EmptyState
          body="No saved portfolios yet — bundle several SKUs into one landed-cost view."
          ctaLabel="Build a portfolio"
          ctaHref="/start/"
        />
      ) : (
        <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] sm:grid-cols-2">
          {items.map((p) => {
            const s = p.snapshot || {};
            return (
              <article
                key={p.id}
                className="group flex flex-col gap-5 bg-[var(--color-ink)] p-6 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-7"
              >
                <div>
                  <h3
                    className="font-serif text-[1.3rem] leading-tight tracking-[-0.016em] text-[var(--color-ivory)]"
                    style={{
                      fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                      fontWeight: 550,
                    }}
                  >
                    {p.label || p.id}
                  </h3>
                  <div className="mt-1.5 font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
                    {p.lineCount ?? 0} SKU{(p.lineCount ?? 0) === 1 ? '' : 's'}
                    {p.savedAt ? ` · saved ${String(p.savedAt).slice(0, 10)}` : ''}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] sm:grid-cols-3">
                  <Metric
                    label="Landed / shipment"
                    value={eur(s.totals?.perShipmentLandedTotal)}
                  />
                  <Metric
                    label="Blended duty"
                    value={s.blendedDutyRatePct != null ? `${s.blendedDutyRatePct}%` : '—'}
                  />
                  <Metric
                    label="Consolidation saving"
                    value={eur(s.consolidationSavingEur)}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-[var(--color-ink)] p-4">
      <div className="font-mono text-[13px] font-medium tabular-nums text-[var(--color-ivory)]">
        {value}
      </div>
      <div className="font-serif text-[11.5px] italic text-[var(--color-ivory-mute)]">
        {label}
      </div>
    </div>
  );
}
