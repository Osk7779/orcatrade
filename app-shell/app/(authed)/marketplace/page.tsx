'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { AuthNotice, ErrorNotice, LoadingNotice } from '@/components/States';
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
  provider: {
    id: string;
    name: string;
    introContact: string;
    takeRatePct: number;
    products: string[];
    region: string;
  };
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
      .then((d) => {
        setProviders(d.providers || []);
        setState('ready');
      })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  async function requestIntro(p: Provider) {
    setBusyId(p.id);
    setErr(null);
    setIntroResult(null);
    try {
      const r = await apiPost<IntroResponse>('/marketplace/intro', { providerId: p.id });
      setIntroResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Intro request failed.');
    } finally {
      setBusyId(null);
    }
  }

  if (state === 'loading') return <LoadingNotice label="Loading marketplace…" />;
  if (state === 'auth')
    return (
      <AuthNotice
        title="Sign in to use the marketplace."
        sub="Curated trade finance and insurance providers. Sign in with a magic link to request a recorded intro."
      />
    );
  if (state === 'error')
    return <ErrorNotice label="Couldn't load the marketplace. Please retry shortly." />;

  const filtered = filter ? providers.filter((p) => p.products.includes(filter)) : providers;
  const productSet = Array.from(new Set(providers.flatMap((p) => p.products))).sort();

  return (
    <div className="max-w-[800px]">
      <PageHeader
        kicker="Marketplace"
        title="Trade finance &amp; insurance."
        sub="Curated providers for letter-of-credit issuance, supply-chain finance, invoice discounting, trade-credit insurance and cargo cover. OrcaTrade is an introducer — not a broker, adviser, or principal. The request below records the intro for audit and shares the provider's contact path; you negotiate directly."
      />

      {err && (
        <div className="mb-6 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
          <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{err}</p>
        </div>
      )}

      <div className="mb-8 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter('')}
          className={`border px-3 py-1.5 font-mono text-[11px] tracking-[0.04em] transition-colors duration-300 ${
            filter === ''
              ? 'border-[var(--color-ivory)] text-[var(--color-ivory)]'
              : 'border-[var(--color-navy-line)] text-[var(--color-ivory-mute)] hover:border-[var(--color-ivory-dim)] hover:text-[var(--color-ivory-dim)]'
          }`}
        >
          All
        </button>
        {productSet.map((p) => (
          <button
            key={p}
            onClick={() => setFilter(p)}
            className={`border px-3 py-1.5 font-mono text-[11px] tracking-[0.04em] transition-colors duration-300 ${
              filter === p
                ? 'border-[var(--color-ivory)] text-[var(--color-ivory)]'
                : 'border-[var(--color-navy-line)] text-[var(--color-ivory-mute)] hover:border-[var(--color-ivory-dim)] hover:text-[var(--color-ivory-dim)]'
            }`}
          >
            {PRODUCT_LABELS[p] || p}
          </button>
        ))}
      </div>

      {introResult && (
        <div className="mb-8 border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-6">
          <div className="flex items-center gap-3">
            <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/60">
              ❦
            </span>
            <span className="font-serif text-[11.5px] italic tracking-[0.05em] text-[var(--color-ivory-mute)]">
              Intro recorded
            </span>
          </div>
          <h2
            className="mt-3 font-serif text-[1.4rem] leading-[1.15] tracking-[-0.012em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
          >
            {introResult.provider.name}
          </h2>
          <div className="mt-3 font-mono text-[12.5px] tabular-nums text-[var(--color-ivory-dim)]">
            {introResult.provider.introContact}
          </div>
          <p className="mt-4 max-w-[60ch] font-serif text-[14px] italic leading-[1.55] text-[var(--color-ivory-dim)]">
            {introResult.followUp}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {filtered.map((p) => (
          <section
            key={p.id}
            className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-6 transition-colors duration-300 hover:border-[var(--color-ivory-dim)]/30"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3
                  className="font-serif text-[1.25rem] leading-[1.2] tracking-[-0.01em] text-[var(--color-ivory)]"
                  style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                >
                  {p.name}
                </h3>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tracking-[0.04em] text-[var(--color-ivory-mute)]">
                  <span>{p.region}</span>
                  <span aria-hidden className="inline-block size-1 bg-[var(--color-ivory-mute)]/40" />
                  <span>take-rate {p.takeRatePct}%</span>
                </div>
              </div>
              <button
                disabled={busyId === p.id}
                onClick={() => requestIntro(p)}
                className="group inline-flex shrink-0 items-center gap-2 bg-[var(--color-ivory)] px-5 py-2.5 text-[12px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busyId === p.id ? 'Recording…' : 'Request intro'}
                {busyId !== p.id && (
                  <span
                    aria-hidden
                    className="transition-transform duration-500 group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                )}
              </button>
            </div>
            <p className="mt-4 max-w-[64ch] font-serif text-[14.5px] leading-[1.6] text-[var(--color-ivory-dim)]">
              {p.summary}
            </p>
            {p.notes && (
              <p className="mt-2 max-w-[64ch] font-serif text-[13px] italic leading-[1.55] text-[var(--color-ivory-mute)]">
                {p.notes}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {p.products.map((pr) => (
                <span
                  key={pr}
                  className="border border-[var(--color-navy-line)] px-2 py-0.5 font-mono text-[10.5px] tracking-[0.04em] text-[var(--color-ivory-mute)]"
                >
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
