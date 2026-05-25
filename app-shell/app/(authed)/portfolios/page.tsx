'use client';

import { useEffect, useState } from 'react';
import { apiGet, AuthError, type SavedPortfolio } from '@/lib/api';

function eur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

export default function PortfoliosPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [items, setItems] = useState<SavedPortfolio[]>([]);

  useEffect(() => {
    apiGet<{ ok: boolean; portfolios: SavedPortfolio[] }>('/portfolio/list')
      .then((d) => { setItems(d.portfolios || []); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading your portfolios…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see your portfolios</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load your portfolios. Please retry shortly.</p>;

  return (
    <div>
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Portfolios</div>
      <div className="flex items-end justify-between mb-8">
        <h1 className="text-4xl">Multi-SKU portfolios</h1>
        <a href="/start/" className="text-sm px-4 py-2 bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm font-medium">+ New</a>
      </div>

      {!items.length ? (
        <div className="border border-dashed border-[var(--color-line)] px-6 py-10 text-center text-white/60">
          <p className="mb-4">No saved portfolios yet — bundle several SKUs into one landed-cost view.</p>
          <a href="/start/" className="text-[var(--color-accent)] underline">Build a portfolio →</a>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {items.map((p) => {
            const s = p.snapshot || {};
            return (
              <div key={p.id} className="border border-[var(--color-line)] p-5">
                <div className="font-serif text-lg text-ivory mb-1">{p.label || p.id}</div>
                <div className="font-mono text-xs text-white/45 mb-4">
                  {p.lineCount ?? 0} SKU{(p.lineCount ?? 0) === 1 ? '' : 's'}
                  {p.savedAt ? ` · saved ${String(p.savedAt).slice(0, 10)}` : ''}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Landed / shipment" value={eur(s.totals?.perShipmentLandedTotal)} />
                  <Metric label="Blended duty" value={s.blendedDutyRatePct != null ? `${s.blendedDutyRatePct}%` : '—'} />
                  <Metric label="Consolidation saving" value={eur(s.consolidationSavingEur)} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-white/85">{value}</div>
      <div className="text-[0.62rem] uppercase tracking-wider text-white/40 mt-0.5">{label}</div>
    </div>
  );
}
