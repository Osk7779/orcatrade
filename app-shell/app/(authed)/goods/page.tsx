'use client';

// Goods master dashboard — list view. Mirrors /shipments in shape.
// Each row links to /goods/<externalId> for the detail view.
//
// Reads:
//   GET /api/goods → Goods[]
//
// Empty-state cross-links to the /start wizard so a user who lands
// here without saved goods is guided to the place they're created.
// (Goods inherit from the wizard via PR #94's quote-time inheritance.)

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, AuthError, type Goods } from '@/lib/api';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + (cents / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type LoadState = 'loading' | 'auth' | 'error' | 'ready';

export default function GoodsListPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [goods, setGoods] = useState<Goods[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; goods: Goods[] }>('/goods')
      .then((d) => { if (!cancelled) { setGoods(d.goods || []); setState('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { setState('auth'); return; }
        setErrorMsg(e instanceof Error ? e.message : 'Could not load goods.');
        setState('error');
      });
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading goods…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see your goods</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">{errorMsg}</p>;

  const cbamCount = goods.filter((g) => g.cbamInScope).length;

  return (
    <div className="max-w-5xl">
      <h1 className="text-4xl mb-1">Goods</h1>
      <p className="font-mono text-xs text-white/45 mb-8">Per-SKU master records · L1.1</p>

      {goods.length === 0 ? (
        <section className="border border-[var(--color-navy-line)] p-6">
          <h2 className="font-serif text-xl mb-1">No goods saved yet</h2>
          <p className="font-mono text-xs text-white/45 mt-2">
            Build your import plan in the{' '}
            <Link href="/start" className="underline">wizard</Link>{' '}
            with a SKU. Saved plans become inherited goods entries that
            future shipments draw classification from automatically.
          </p>
        </section>
      ) : (
        <section className="border border-[var(--color-navy-line)]">
          <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
            <h2 className="font-serif text-xl">All goods</h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
              {goods.length} total · {cbamCount} CBAM-in-scope
            </span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
                <th className="px-6 py-3 font-normal">SKU</th>
                <th className="px-2 py-3 font-normal">Display name</th>
                <th className="px-2 py-3 font-normal">HS code</th>
                <th className="px-2 py-3 font-normal">Origin</th>
                <th className="px-2 py-3 font-normal">CBAM</th>
                <th className="px-6 py-3 font-normal text-right">Typical value</th>
              </tr>
            </thead>
            <tbody>
              {goods.map((g) => (
                <tr
                  key={g.externalId}
                  className="border-t border-[var(--color-navy-line)] hover:bg-[var(--color-navy-soft)]/30 transition-colors"
                >
                  <td className="px-6 py-4 font-mono text-[12px] text-white">
                    <Link href={`/goods/${encodeURIComponent(g.externalId)}`} className="hover:underline">
                      {g.sku}
                    </Link>
                  </td>
                  <td className="px-2 py-4 font-serif text-[14px] text-white">{g.displayName}</td>
                  <td className="px-2 py-4 font-mono text-[12px] text-white/70">{g.hsCode}</td>
                  <td className="px-2 py-4 font-mono text-[12px] text-white/70">{g.originCountry || '—'}</td>
                  <td className="px-2 py-4">
                    {g.cbamInScope && (
                      <span
                        className="font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 border"
                        style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}
                      >
                        In scope
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono text-[12px] text-white/70 text-right">
                    {eurFromCents(g.typicalUnitValueCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
