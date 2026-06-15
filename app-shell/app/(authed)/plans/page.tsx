'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet, AuthError, type SavedPlan } from '@/lib/api';

// PR #150: client-side filter for the saved-plan list. Matches against
// label, product category, HS code, origin + destination country, and
// the plan id — the same fields rendered in each list row. Token-based
// (whitespace-split) so multi-word queries like "apparel CN DE" filter
// down to the intersection. Case-insensitive.
//
// Why client-side: the /plans endpoint returns the user's full list
// (today's typical surface area is well under 1,000 records per user),
// each row is small (~1 KB), and pre-filtering server-side would
// either require a search index we don't have or a LIKE-over-many-
// columns query that wouldn't beat in-memory matching at this scale.
// When the list crosses ~5k records we'll swap this for a server-
// side search endpoint.
function planMatchesQuery(p: SavedPlan, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const inp = p.inputs || {};
  const haystack = [
    p.label || '',
    p.id || '',
    inp.productCategory || '',
    inp.hsCode || '',
    inp.originCountry || '',
    inp.destinationCountry || '',
  ]
    .join(' ')
    .toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

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

// Reproducibility verdict from the server-stamped flag (no extra fetch per row).
// Stays out of the way: green tick on full reproducibility, amber diamond when
// the market data has moved, nothing when no snapshot was bound (legacy plans).
function ReproBadge({ p }: { p: SavedPlan }) {
  if (p.reproducible == null) return null;
  if (p.reproducible) {
    return (
      <span className="font-mono text-xs px-2 py-0.5 rounded-sm text-emerald-300 bg-emerald-500/10"
        title="Reproducible — market data unchanged since you saved this plan">
        ✓ reproducible
      </span>
    );
  }
  return (
    <span className="font-mono text-xs px-2 py-0.5 rounded-sm text-amber-300 bg-amber-500/10"
      title="Market data has drifted; the original euros are still recoverable from the stored snapshot — open the plan to see the original vs today.">
      ◆ drifted
    </span>
  );
}

export default function PlansPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    apiGet<{ ok: boolean; plans: SavedPlan[] }>('/plans')
      .then((d) => { setPlans(d.plans || []); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );
  const filteredPlans = useMemo(
    () => plans.filter((p) => planMatchesQuery(p, tokens)),
    [plans, tokens],
  );

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
        <>
          {/* PR #150: client-side search. Filters by label, category,
              HS code, origin / destination country, and plan id. */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <label className="flex-1 max-w-md">
              <span className="sr-only">Filter saved plans</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by label, category, HS code, country…"
                aria-label="Filter saved plans"
                className="block w-full bg-[var(--color-ink)] border border-[var(--color-line)] px-3 py-1.5 font-mono text-[12px] text-white placeholder:text-white/35 focus:outline-none focus:border-white/45"
              />
            </label>
            {query.trim() !== '' && (
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45 shrink-0">
                {filteredPlans.length} of {plans.length}
              </span>
            )}
          </div>
          {filteredPlans.length === 0 ? (
            <div className="border border-dashed border-[var(--color-line)] px-6 py-8 text-center font-mono text-xs text-white/55">
              No plans match “{query.trim()}”. Try fewer or different keywords.
            </div>
          ) : (
        <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
          {filteredPlans.map((p) => {
            const landed = p.current?.perShipmentLandedTotal ?? p.snapshot?.perShipmentLandedTotal;
            const inp = p.inputs || {};
            return (
              <Link key={p.id} href={`/plans/${p.id}`} className="flex items-center justify-between px-5 py-4 hover:bg-white/[0.03]">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="font-serif text-lg text-ivory truncate">{p.label || inp.productCategory || p.id}</span>
                    <DriftBadge delta={p.delta} />
                    <ReproBadge p={p} />
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
              </Link>
            );
          })}
        </div>
          )}
        </>
      )}

      <p className="text-white/40 text-xs mt-6">
        Figures recompute against today’s tariff, freight and FX data. A ▲/▼ badge marks plans whose landed cost has moved ≥5% since you saved them; ✓ / ◆ marks reproducibility against the stored data snapshot.
      </p>
    </div>
  );
}
