'use client';

import { useEffect, useState } from 'react';
import { apiGet, AuthError, type SavedPlan } from '@/lib/api';

function eur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

function DriftBadge({ delta }: { delta?: SavedPlan['delta'] }) {
  if (!delta || !delta.significant || delta.landedDeltaPct == null) return null;
  const up = (delta.landedDeltaPct ?? 0) >= 0;
  return (
    <span
      className={`font-mono text-xs px-2 py-0.5 rounded-sm ${up ? 'text-red-300 bg-red-500/10' : 'text-emerald-300 bg-emerald-500/10'}`}
      title={`${eur(delta.landedDeltaEur)} since saved${delta.primaryDriver ? ` · mostly ${delta.primaryDriver}` : ''}`}
    >
      {up ? '▲' : '▼'} {Math.abs(delta.landedDeltaPct)}%
    </span>
  );
}

export default function PlansPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [plans, setPlans] = useState<SavedPlan[]>([]);

  useEffect(() => {
    apiGet<{ ok: boolean; plans: SavedPlan[] }>('/plans')
      .then((d) => { setPlans(d.plans || []); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading your plans…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see your plans</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load your plans. Please retry shortly.</p>;

  return (
    <div>
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Plans</div>
      <div className="flex items-end justify-between mb-8">
        <h1 className="text-4xl">Saved import plans</h1>
        <a href="/start/" className="text-sm px-4 py-2 bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm font-medium">+ New plan</a>
      </div>

      {!plans.length ? (
        <div className="border border-dashed border-[var(--color-line)] px-6 py-10 text-center text-white/60">
          <p className="mb-4">You haven’t saved any import plans yet.</p>
          <a href="/start/" className="text-[var(--color-accent)] underline">Build your first plan →</a>
        </div>
      ) : (
        <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
          {plans.map((p) => {
            const landed = p.current?.perShipmentLandedTotal ?? p.snapshot?.perShipmentLandedTotal;
            const inp = p.inputs || {};
            return (
              <div key={p.id} className="flex items-center justify-between px-5 py-4 hover:bg-white/[0.03]">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-serif text-lg text-ivory truncate">{p.label || inp.productCategory || p.id}</span>
                    <DriftBadge delta={p.delta} />
                  </div>
                  <div className="font-mono text-xs text-white/45 mt-1">
                    {(inp.originCountry || '?')}→{(inp.destinationCountry || '?')}
                    {inp.hsCode ? ` · HS ${inp.hsCode}` : ''}
                    {p.savedAt ? ` · saved ${String(p.savedAt).slice(0, 10)}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0 pl-4">
                  <div className="font-mono text-sm text-white/85">{eur(landed)}</div>
                  <div className="text-[0.66rem] uppercase tracking-wider text-white/40">landed / shipment</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-white/40 text-xs mt-6">
        Figures recompute against today’s tariff, freight and FX data. A ▲/▼ badge marks plans whose landed cost has moved ≥5% since you saved them.
      </p>
    </div>
  );
}
