'use client';

// Goods master detail — per-SKU view. Mirrors /shipments/<id> in shape
// but with goods-specific fields (HS code, origin, REACH SVHC,
// restricted substances). No state machine.

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  apiGet,
  AuthError,
  type Goods,
} from '@/lib/api';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + (cents / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IE'); } catch { return d; }
}

type LoadState = 'loading' | 'auth' | 'error' | 'notFound' | 'ready';

export default function GoodsDetailPage({ params }: { params: Promise<{ externalId: string }> }) {
  const { externalId } = use(params);
  const [state, setState] = useState<LoadState>('loading');
  const [goods, setGoods] = useState<Goods | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; goods: Goods }>(`/goods/${encodeURIComponent(externalId)}`)
      .then((d) => { if (!cancelled) { setGoods(d.goods); setState('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { setState('auth'); return; }
        const msg = e instanceof Error ? e.message : 'Could not load goods.';
        if (/404|not found/i.test(msg)) { setState('notFound'); return; }
        setErrorMsg(msg);
        setState('error');
      });
    return () => { cancelled = true; };
  }, [externalId]);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading goods…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see this good</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'notFound') {
    return (
      <div className="max-w-xl">
        <Link href="/goods" className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45 hover:text-white">← All goods</Link>
        <h1 className="text-4xl mt-3 mb-1">Not found</h1>
        <p className="font-mono text-xs text-white/45">This good doesn't exist in your organisation, or it has been archived.</p>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">{errorMsg}</p>;
  if (!goods) return null;

  return (
    <div className="max-w-4xl">
      <Header goods={goods} />
      <FactsGrid goods={goods} />
      {goods.reachSvhcFlags && goods.reachSvhcFlags.length > 0 && (
        <ReachSvhcPanel goods={goods} />
      )}
      {goods.restrictedSubstances && Object.keys(goods.restrictedSubstances).length > 0 && (
        <RestrictedSubstancesPanel goods={goods} />
      )}
    </div>
  );
}

function Header({ goods }: { goods: Goods }) {
  return (
    <header className="mb-8">
      <Link href="/goods" className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45 hover:text-white">
        ← All goods
      </Link>
      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-4xl text-white">{goods.displayName}</h1>
          <p className="font-mono text-[12px] text-white/55 mt-2">
            SKU {goods.sku} · {goods.externalId}
          </p>
        </div>
        {goods.cbamInScope && (
          <span
            className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border"
            style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}
          >
            CBAM in scope
          </span>
        )}
      </div>
    </header>
  );
}

function FactsGrid({ goods }: { goods: Goods }) {
  const facts = [
    { label: 'SKU', value: goods.sku },
    { label: 'HS code', value: goods.hsCode },
    { label: 'Origin', value: goods.originCountry ?? '—' },
    { label: 'Typical unit value', value: eurFromCents(goods.typicalUnitValueCents) },
    { label: 'CBAM in scope', value: goods.cbamInScope ? 'Yes' : 'No' },
    { label: 'Created', value: fmtDate(goods.createdAt) },
    { label: 'Updated', value: fmtDate(goods.updatedAt) },
    { label: 'Archived', value: goods.archivedAt ? fmtDate(goods.archivedAt) : '—' },
  ];
  return (
    <section className="mb-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-navy-line)] border border-[var(--color-navy-line)]">
      {facts.map((f) => (
        <div key={f.label} className="bg-[var(--color-ink)] px-4 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{f.label}</div>
          <div className="font-mono text-[13px] text-white mt-1.5">{f.value}</div>
        </div>
      ))}
    </section>
  );
}

function ReachSvhcPanel({ goods }: { goods: Goods }) {
  const flags = goods.reachSvhcFlags || [];
  return (
    <section className="mb-10 border" style={{ borderColor: 'var(--color-warning)' }}>
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl" style={{ color: 'var(--color-warning)' }}>REACH SVHC flags</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-warning)' }}>
          {flags.length} declared
        </span>
      </div>
      <ul>
        {flags.map((f, i) => (
          <li key={f.cas || `flag-${i}`} className="px-6 py-3 border-t border-[var(--color-navy-line)] flex items-center justify-between gap-6">
            <div>
              <div className="font-serif text-[14px] text-white">{f.name || f.cas || 'Unnamed SVHC'}</div>
              <div className="font-mono text-[11px] text-white/55 mt-1">
                {f.cas ? `CAS ${f.cas}` : ''}
                {f.threshold_pct != null ? ` · threshold ${f.threshold_pct}%` : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RestrictedSubstancesPanel({ goods }: { goods: Goods }) {
  const subs = goods.restrictedSubstances || {};
  const json = useMemo(() => JSON.stringify(subs, null, 2), [subs]);
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)]">
        <h2 className="font-serif text-xl">Restricted substances</h2>
        <p className="font-mono text-[11px] text-white/45 mt-1">
          Per-jurisdiction notes captured at goods-master creation.
        </p>
      </div>
      <details className="m-6">
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-white/65 hover:text-white">
          restrictedSubstances
        </summary>
        <pre className="mt-3 font-mono text-[11px] text-white/70 overflow-x-auto whitespace-pre">{json}</pre>
      </details>
    </section>
  );
}
