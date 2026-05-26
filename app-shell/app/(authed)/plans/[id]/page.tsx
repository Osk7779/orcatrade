'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, AuthError, type SavedPlan } from '@/lib/api';

function eur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

export default function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<'loading' | 'auth' | 'missing' | 'error' | 'ready'>('loading');
  const [plan, setPlan] = useState<SavedPlan | null>(null);

  useEffect(() => {
    apiGet<{ ok: boolean; plan: SavedPlan }>(`/plans/${id}`)
      .then((d) => { setPlan(d.plan); setState('ready'); })
      .catch((e) => {
        if (e instanceof AuthError) setState('auth');
        else if (String(e).includes('404')) setState('missing');
        else setState('error');
      });
  }, [id]);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading plan…</p>;
  if (state === 'auth') return <div className="max-w-md"><h1 className="text-3xl mb-3">Sign in to view this plan</h1><a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a></div>;
  if (state === 'missing') return <div><Link href="/plans" className="text-[var(--color-accent)] text-sm">← Plans</Link><p className="text-white/60 mt-4">Plan not found.</p></div>;
  if (state === 'error' || !plan) return <p className="text-red-400 text-sm">Couldn’t load this plan.</p>;

  const inp = plan.inputs || {};
  const cur = plan.current || plan.snapshot || {};
  const d = plan.delta;
  const rows: Array<[string, string]> = [
    ['Duty', eur(cur.dutyEur) + (cur.dutyRatePct != null ? ` (${cur.dutyRatePct}%)` : '')],
    ['Import VAT', eur(cur.vatEur)],
    ['Transport', eur(cur.transportEur)],
    ['Brokerage', eur(cur.brokerageEur)],
  ];

  return (
    <div className="max-w-2xl">
      <Link href="/plans" className="text-[var(--color-accent)] text-sm">← Plans</Link>
      <h1 className="text-4xl mt-3 mb-1">{plan.label || inp.productCategory || plan.id}</h1>
      <div className="font-mono text-xs text-white/45 mb-8">
        {(inp.originCountry || '?')}→{(inp.destinationCountry || '?')}
        {inp.hsCode ? ` · HS ${inp.hsCode}` : ''}
        {plan.savedAt ? ` · saved ${String(plan.savedAt).slice(0, 10)}` : ''}
      </div>

      <div className="border border-[var(--color-line)] border-t-2 border-t-[var(--color-accent)] px-5 py-5 mb-6">
        <div className="text-[0.7rem] uppercase tracking-wider text-white/50 mb-1">Landed cost / shipment (today)</div>
        <div className="font-serif text-4xl text-ivory">{eur(cur.perShipmentLandedTotal)}</div>
        {d && d.significant && d.landedDeltaPct != null && (
          <div className={`mt-2 text-sm ${d.landedDeltaPct >= 0 ? 'text-red-300' : 'text-emerald-300'}`}>
            {d.landedDeltaPct >= 0 ? '▲' : '▼'} {Math.abs(d.landedDeltaPct)}% ({eur(d.landedDeltaEur)}) since saved
            {d.primaryDriver ? ` · mostly ${d.primaryDriver}` : ''}
            {typeof d.daysSinceSaved === 'number' ? ` · ${d.daysSinceSaved}d ago` : ''}
          </div>
        )}
      </div>

      <h2 className="text-xl mb-3">Cost breakdown</h2>
      <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)] mb-6">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between px-5 py-3 text-sm">
            <span className="text-white/65">{k}</span>
            <span className="font-mono text-white/90">{v}</span>
          </div>
        ))}
        <div className="flex justify-between px-5 py-3 text-sm">
          <span className="text-ivory">Customs value</span>
          <span className="font-mono text-white/90">{eur(inp.customsValueEur)}</span>
        </div>
      </div>

      <p className="text-white/40 text-xs">
        Recomputed against today’s tariff, freight and FX data. Manage or re-run this plan on the{' '}
        <a className="underline" href="/account/plans/">classic plans page</a>.
      </p>
    </div>
  );
}
