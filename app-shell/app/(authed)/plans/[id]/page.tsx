'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, AuthError, type SavedPlan, type Reproduction } from '@/lib/api';

function eur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

function fmtVal(v: unknown) {
  if (v == null) return '—';
  return String(v);
}

export default function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<'loading' | 'auth' | 'missing' | 'error' | 'ready'>('loading');
  const [plan, setPlan] = useState<SavedPlan | null>(null);
  const [repro, setRepro] = useState<Reproduction | null>(null);

  useEffect(() => {
    apiGet<{ ok: boolean; plan: SavedPlan }>(`/plans/${id}`)
      .then((d) => { setPlan(d.plan); setState('ready'); })
      .catch((e) => {
        if (e instanceof AuthError) setState('auth');
        else if (String(e).includes('404')) setState('missing');
        else setState('error');
      });
    // Reproducibility verdict (III3) — best-effort; a failure just hides the panel.
    apiGet<Reproduction>(`/plans/${id}/reproduce`).then(setRepro).catch(() => {});
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

      {repro && <ReproPanel r={repro} />}

      <p className="text-white/40 text-xs">
        Recomputed against today’s tariff, freight and FX data. Manage or re-run this plan on the{' '}
        <a className="underline" href="/account/plans/">classic plans page</a>.
      </p>
    </div>
  );
}

function ReproPanel({ r }: { r: Reproduction }) {
  const unchanged = r.status === 'data-unchanged';
  const drifted = r.status === 'data-drifted';
  const accent = unchanged ? 'var(--color-accent)' : drifted ? '#F59E0B' : 'var(--color-line)';
  const label = unchanged ? 'Reproducible — data unchanged'
    : drifted ? 'Data has drifted since you saved this'
    : r.status === 'no-snapshot-bound' ? 'No snapshot bound'
    : 'Original snapshot unavailable';

  return (
    <section
      className="border border-[var(--color-line)] px-5 py-5 mb-6"
      style={{ borderTopWidth: 2, borderTopColor: accent }}
    >
      <div className="text-[0.7rem] uppercase tracking-wider text-white/50 mb-1">Reproducibility</div>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: accent }} className="text-lg leading-none">{unchanged ? '✓' : drifted ? '◆' : '•'}</span>
        <span className="text-ivory text-sm font-medium">{label}</span>
      </div>
      {r.message && <p className="text-white/55 text-xs mb-3">{r.message}</p>}

      {/* The headline payoff: the ORIGINAL landed total, recomputed from the stored snapshot. */}
      {drifted && r.landedReproduction && (
        <div className="grid grid-cols-2 gap-px bg-[var(--color-line)] border border-[var(--color-line)] mb-3">
          <div className="bg-[var(--color-ink)] px-4 py-3">
            <div className="text-[0.65rem] uppercase tracking-wider text-white/45 mb-1">Original (as saved)</div>
            <div className="font-serif text-2xl text-ivory">{eur(r.landedReproduction.original.perShipmentLandedTotal)}</div>
          </div>
          <div className="bg-[var(--color-ink)] px-4 py-3">
            <div className="text-[0.65rem] uppercase tracking-wider text-white/45 mb-1">Recomputed today</div>
            <div className="font-serif text-2xl text-ivory">{eur(r.landedReproduction.current?.perShipmentLandedTotal)}</div>
          </div>
        </div>
      )}

      {/* Exactly which market-data values moved. */}
      {drifted && r.drift && r.drift.length > 0 && (
        <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)] mb-3">
          {r.drift.slice(0, 8).map((c) => (
            <div key={c.field} className="flex justify-between gap-3 px-4 py-2 text-xs">
              <span className="text-white/60">{c.label || c.field}</span>
              <span className="font-mono text-white/85 whitespace-nowrap">{fmtVal(c.from)} → {fmtVal(c.to)}</span>
            </div>
          ))}
          {r.drift.length > 8 && <div className="px-4 py-2 text-xs text-white/40">+{r.drift.length - 8} more</div>}
        </div>
      )}

      {r.storedSnapshotId && (
        <div className="font-mono text-[0.65rem] text-white/35">
          snapshot {r.storedSnapshotId}{r.currentSnapshotId && r.currentSnapshotId !== r.storedSnapshotId ? ` → ${r.currentSnapshotId}` : ''}
        </div>
      )}
    </section>
  );
}
