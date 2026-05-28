'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, AuthError } from '@/lib/api';

interface Provider {
  id: string;
  name: string;
  region: string;
  products: string[];
  summary: string;
  notes?: string;
  takeRatePct: number;
  introContact: string;
}
interface IntroResponse {
  ok: boolean;
  provider: { id: string; name: string; introContact: string; takeRatePct: number; products: string[]; region: string };
  followUp: string;
}

const PRODUCT_LABELS: Record<string, string> = {
  lc: 'Letter of credit',
  scf: 'Supply-chain financing',
  tci: 'Trade credit insurance',
  invoice_financing: 'Invoice financing',
  cargo_insurance: 'Cargo insurance',
};

export default function MarketplacePage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [introResult, setIntroResult] = useState<IntroResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ ok: boolean; providers: Provider[]; disclaimer: string }>('/marketplace')
      .then((d) => { setProviders(d.providers || []); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  async function requestIntro(p: Provider) {
    setBusyId(p.id); setErr(null); setIntroResult(null);
    try {
      const r = await apiPost<IntroResponse>('/marketplace/intro', { providerId: p.id });
      setIntroResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Intro request failed.');
    } finally { setBusyId(null); }
  }

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading marketplace…</p>;
  if (state === 'auth') return (
    <div className="max-w-md"><h1 className="text-3xl mb-3">Sign in to use the marketplace</h1>
      <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a></div>
  );
  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load the marketplace.</p>;

  const filtered = filter ? providers.filter((p) => p.products.includes(filter)) : providers;
  const productSet = Array.from(new Set(providers.flatMap((p) => p.products))).sort();

  return (
    <div className="max-w-3xl">
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Marketplace</div>
      <h1 className="text-4xl mb-2">Trade finance &amp; insurance</h1>
      <p className="text-white/60 text-sm mb-3 leading-relaxed">
        Curated providers for LC issuance, supply-chain financing, invoice discounting, trade-credit insurance and cargo insurance.
        OrcaTrade is an <b>introducer</b> — not a broker, adviser, or principal. The request below records the intro for audit and shares the provider's contact path; you negotiate directly.
      </p>

      {err && <p className="text-red-400 text-sm mb-3">{err}</p>}

      <div className="flex flex-wrap gap-2 mb-6">
        <button onClick={() => setFilter('')}
          className={`text-xs font-mono px-3 py-1.5 rounded-sm border ${filter === '' ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-line)] text-white/60'}`}>
          All
        </button>
        {productSet.map((p) => (
          <button key={p} onClick={() => setFilter(p)}
            className={`text-xs font-mono px-3 py-1.5 rounded-sm border ${filter === p ? 'border-[var(--color-accent)] text-[var(--color-accent)]' : 'border-[var(--color-line)] text-white/60'}`}>
            {PRODUCT_LABELS[p] || p}
          </button>
        ))}
      </div>

      {introResult && (
        <div className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 text-sm px-4 py-3 mb-5">
          <div className="font-medium">{introResult.provider.name} · intro recorded</div>
          <div className="font-mono text-xs mt-1">{introResult.provider.introContact}</div>
          <p className="text-emerald-100/80 text-xs mt-2">{introResult.followUp}</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((p) => (
          <section key={p.id} className="border border-[var(--color-line)] px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-ivory text-base font-medium">{p.name}</div>
                <div className="font-mono text-[0.66rem] text-white/45 mt-0.5">{p.region} · take-rate {p.takeRatePct}%</div>
              </div>
              <button disabled={busyId === p.id} onClick={() => requestIntro(p)}
                className="shrink-0 px-3 py-1.5 text-xs font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm disabled:opacity-40">
                Request intro
              </button>
            </div>
            <p className="text-white/70 text-sm mt-2">{p.summary}</p>
            {p.notes && <p className="text-white/45 text-xs mt-1">{p.notes}</p>}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {p.products.map((pr) => (
                <span key={pr} className="font-mono text-[0.62rem] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-white/[0.04] text-white/65 border border-white/10">
                  {PRODUCT_LABELS[pr] || pr}
                </span>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
