'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, AuthError, type SavedPlan } from '@/lib/api';

function eur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

export default function OperationsPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [plans, setPlans] = useState<SavedPlan[]>([]);

  useEffect(() => {
    apiGet<{ ok: boolean; plans: SavedPlan[] }>('/plans')
      .then((d) => { setPlans(d.plans || []); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading operations…</p>;
  if (state === 'auth') return (
    <div className="max-w-md"><h1 className="text-3xl mb-3">Sign in to see your operations</h1>
      <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a></div>
  );
  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load operations.</p>;

  const withCost = plans.filter((p) => p.current?.perShipmentLandedTotal != null);
  const totalExposure = withCost.reduce((s, p) => s + (p.current!.perShipmentLandedTotal || 0), 0);
  const totalDuty = withCost.reduce((s, p) => s + (p.current!.dutyEur || 0), 0);
  const maxLanded = Math.max(1, ...withCost.map((p) => p.current!.perShipmentLandedTotal || 0));

  // Drift ledger: plans whose recompute moved materially since saved.
  const drifted = plans
    .filter((p) => p.delta && p.delta.significant && p.delta.landedDeltaEur != null)
    .sort((a, b) => Math.abs(b.delta!.landedDeltaEur!) - Math.abs(a.delta!.landedDeltaEur!));
  const captured = drifted
    .filter((p) => (p.delta!.landedDeltaEur || 0) < 0)
    .reduce((s, p) => s + Math.abs(p.delta!.landedDeltaEur || 0), 0);

  const label = (p: SavedPlan) =>
    p.label || `${p.inputs?.originCountry || '?'}→${p.inputs?.destinationCountry || '?'}`;
  const barColor = (p: SavedPlan) =>
    p.delta?.significant ? (p.delta.landedDeltaPct! >= 0 ? '#EF4444' : '#10B981') : 'var(--color-accent-soft)';

  return (
    <div className="max-w-3xl">
      <h1 className="text-4xl mb-1">Operations</h1>
      <p className="font-mono text-xs text-white/45 mb-8">
        Live exposure across your saved plans, recomputed against today’s tariff, freight &amp; FX.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-line)] border border-[var(--color-line)] mb-8">
        {[
          ['Landed exposure', eur(totalExposure)],
          ['Duty exposure', eur(totalDuty)],
          ['Plans tracked', String(plans.length)],
          ['Savings captured', eur(captured)],
        ].map(([k, v]) => (
          <div key={k} className="bg-[var(--color-ink)] px-4 py-4">
            <div className="text-[0.65rem] uppercase tracking-wider text-white/45 mb-1">{k}</div>
            <div className="font-serif text-2xl text-ivory">{v}</div>
          </div>
        ))}
      </div>

      {withCost.length === 0 ? (
        <p className="text-white/55 text-sm">No saved plans yet. Build one in the <a className="underline" href="/start/">Import Plan Builder</a>.</p>
      ) : (
        <>
          <h2 className="text-xl mb-3">Exposure by plan</h2>
          <div className="space-y-2 mb-9">
            {withCost
              .slice()
              .sort((a, b) => (b.current!.perShipmentLandedTotal || 0) - (a.current!.perShipmentLandedTotal || 0))
              .map((p) => {
                const v = p.current!.perShipmentLandedTotal || 0;
                return (
                  <Link key={p.id} href={`/plans/${p.id}`} className="block group">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-white/70 group-hover:text-white">{label(p)}</span>
                      <span className="font-mono text-white/85">{eur(v)}</span>
                    </div>
                    <div className="h-2 bg-white/[0.04]">
                      <div className="h-full" style={{ width: `${Math.max(3, (v / maxLanded) * 100)}%`, background: barColor(p) }} />
                    </div>
                  </Link>
                );
              })}
          </div>
          <p className="text-white/35 text-[0.7rem] mb-9">Bars are coloured by drift since you saved: red = cost up, green = down, neutral = stable.</p>
        </>
      )}

      <h2 className="text-xl mb-3">Drift ledger</h2>
      {drifted.length === 0 ? (
        <p className="text-white/55 text-sm">No material moves since you saved these plans.</p>
      ) : (
        <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
          {drifted.map((p) => {
            const up = (p.delta!.landedDeltaPct || 0) >= 0;
            return (
              <Link key={p.id} href={`/plans/${p.id}`} className="flex justify-between gap-3 px-5 py-3 text-sm hover:bg-white/[0.02]">
                <span className="text-white/75">{label(p)}{p.delta!.primaryDriver ? <span className="text-white/40"> · {p.delta!.primaryDriver}</span> : null}</span>
                <span className={`font-mono ${up ? 'text-red-300' : 'text-emerald-300'}`}>
                  {up ? '▲' : '▼'} {eur(Math.abs(p.delta!.landedDeltaEur || 0))} ({Math.abs(p.delta!.landedDeltaPct || 0)}%)
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
