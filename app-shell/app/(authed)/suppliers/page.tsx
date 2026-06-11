'use client';

// Supplier master dashboard — list view. Mirrors /goods in shape.
// Each row links to /suppliers/<externalId> for the detail view.
//
// Reads:
//   GET /api/suppliers → Supplier[]
//
// Empty-state explains that suppliers are created via the API today
// (no wizard surface for supplier-master yet — they're recorded when
// ops promote a saved plan with supplier context, or via the
// /api/suppliers POST endpoint).
//
// PR #127 added a sanctions filter dropdown with URL state
// (?sanctions=clear|pending|potential_match|match|not_screened).
// Pattern mirrors PR #125 (shipments status filter) and the goods
// CBAM filter shipped alongside this PR.

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  apiGet,
  AuthError,
  SUPPLIER_SANCTIONS_STATUSES,
  type Supplier,
  type SupplierSanctionsStatus,
} from '@/lib/api';

function sanctionsTone(s?: SupplierSanctionsStatus | null): string {
  if (s === 'match' || s === 'potential_match') return 'var(--color-critical)';
  if (s === 'clear') return 'var(--color-positive)';
  if (s === 'pending') return 'var(--color-warning)';
  return 'var(--color-ivory-mute)';
}

function sanctionsLabel(s?: SupplierSanctionsStatus | null): string {
  if (!s) return 'Not screened';
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function trustTone(score?: number | null): string {
  if (score == null) return 'var(--color-ivory-mute)';
  if (score >= 80) return 'var(--color-positive)';
  if (score >= 50) return 'var(--color-warning)';
  return 'var(--color-critical)';
}

type LoadState = 'loading' | 'auth' | 'error' | 'ready';

// Filter values: each SupplierSanctionsStatus, PLUS the pseudo-value
// 'not_screened' which selects suppliers with sanctionsLastStatus
// null (never been screened). 'not_screened' is a UI-only concept —
// it never appears in SANCTIONS_STATUSES on the backend.
type SanctionsFilter = SupplierSanctionsStatus | 'not_screened';

function readSanctionsFilter(raw: string | null): SanctionsFilter | null {
  if (!raw) return null;
  if (raw === 'not_screened') return raw;
  return (SUPPLIER_SANCTIONS_STATUSES as ReadonlyArray<string>).includes(raw)
    ? (raw as SupplierSanctionsStatus)
    : null;
}

function matchesFilter(s: Supplier, filter: SanctionsFilter): boolean {
  if (filter === 'not_screened') return s.sanctionsLastStatus == null;
  return s.sanctionsLastStatus === filter;
}

export default function SuppliersListPage() {
  return (
    <Suspense fallback={<p className="text-white/50 text-sm">Loading suppliers…</p>}>
      <SuppliersListView />
    </Suspense>
  );
}

function SuppliersListView() {
  const [state, setState] = useState<LoadState>('loading');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; suppliers: Supplier[] }>('/suppliers')
      .then((d) => { if (!cancelled) { setSuppliers(d.suppliers || []); setState('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { setState('auth'); return; }
        setErrorMsg(e instanceof Error ? e.message : 'Could not load suppliers.');
        setState('error');
      });
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading suppliers…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see your suppliers</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">{errorMsg}</p>;

  return (
    <div className="max-w-5xl">
      <h1 className="text-4xl mb-1">Suppliers</h1>
      <p className="font-mono text-xs text-white/45 mb-8">Per-entity master records · L1.2</p>
      <SuppliersList suppliers={suppliers} />
    </div>
  );
}

function SuppliersList({ suppliers }: { suppliers: Supplier[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeFilter = readSanctionsFilter(searchParams.get('sanctions'));

  // Per-bucket counts computed off the FULL list so dropdown labels
  // stay stable while the user filters (PR #125 invariant).
  const countByStatus = useMemo(() => {
    const map: Partial<Record<SanctionsFilter, number>> = {};
    let notScreened = 0;
    for (const s of suppliers) {
      if (s.sanctionsLastStatus == null) {
        notScreened += 1;
      } else {
        map[s.sanctionsLastStatus as SanctionsFilter] =
          (map[s.sanctionsLastStatus as SanctionsFilter] || 0) + 1;
      }
    }
    map['not_screened'] = notScreened;
    return map;
  }, [suppliers]);

  const matchCount = (countByStatus['match'] || 0) + (countByStatus['potential_match'] || 0);

  const visibleSuppliers = useMemo(() => {
    if (!activeFilter) return suppliers;
    return suppliers.filter((s) => matchesFilter(s, activeFilter));
  }, [suppliers, activeFilter]);

  function setFilter(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!next) {
      params.delete('sanctions');
    } else {
      params.set('sanctions', next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  if (suppliers.length === 0) {
    return (
      <section className="border border-[var(--color-navy-line)] p-6">
        <h2 className="font-serif text-xl mb-1">No suppliers saved yet</h2>
        <p className="font-mono text-xs text-white/45 mt-2">
          Suppliers are created via POST <code className="text-white/80">/api/suppliers</code>
          {' '}with entity name, HQ country, and optional registration number. Once a
          supplier exists, sanctions screening runs nightly and the trust score is
          recomputed as audits, history, and EUDR DDS evidence land.
        </p>
      </section>
    );
  }

  return (
    <section className="border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-serif text-xl">All suppliers</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
              Filter
            </span>
            <select
              value={activeFilter || ''}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter suppliers by sanctions status"
              className="bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-white focus:outline-none focus:border-white/55"
            >
              <option value="">All ({suppliers.length})</option>
              {SUPPLIER_SANCTIONS_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {sanctionsLabel(s)} ({countByStatus[s] || 0})
                </option>
              ))}
              <option value="not_screened">
                Not screened ({countByStatus['not_screened'] || 0})
              </option>
            </select>
          </label>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
            {activeFilter
              ? `${visibleSuppliers.length} of ${suppliers.length}`
              : (
                <>
                  {suppliers.length} total
                  {matchCount > 0 ? ` · ${matchCount} sanctions concern` : ''}
                </>
              )}
          </span>
        </div>
      </div>
      {visibleSuppliers.length === 0 ? (
        <p className="px-6 py-8 font-mono text-xs text-white/45">
          No suppliers matching this filter.{' '}
          <button
            type="button"
            onClick={() => setFilter('')}
            className="underline hover:text-white"
          >
            Clear filter
          </button>
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
              <th className="px-6 py-3 font-normal">Entity</th>
              <th className="px-2 py-3 font-normal">HQ</th>
              <th className="px-2 py-3 font-normal">Form</th>
              <th className="px-2 py-3 font-normal">Sanctions</th>
              <th className="px-6 py-3 font-normal text-right">Trust score</th>
            </tr>
          </thead>
          <tbody>
            {visibleSuppliers.map((s) => (
              <tr
                key={s.externalId}
                className="border-t border-[var(--color-navy-line)] hover:bg-[var(--color-navy-soft)]/30 transition-colors"
              >
                <td className="px-6 py-4 font-serif text-[14px] text-white">
                  <Link href={`/suppliers/${encodeURIComponent(s.externalId)}`} className="hover:underline">
                    {s.entityName}
                  </Link>
                </td>
                <td className="px-2 py-4 font-mono text-[12px] text-white/70">{s.hqCountry}</td>
                <td className="px-2 py-4 font-mono text-[11px] text-white/60 uppercase">{s.legalForm || '—'}</td>
                <td className="px-2 py-4">
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 border"
                    style={{
                      borderColor: sanctionsTone(s.sanctionsLastStatus),
                      color: sanctionsTone(s.sanctionsLastStatus),
                    }}
                  >
                    {sanctionsLabel(s.sanctionsLastStatus)}
                  </span>
                </td>
                <td
                  className="px-6 py-4 font-mono text-[13px] text-right"
                  style={{ color: trustTone(s.trustScore) }}
                >
                  {s.trustScore != null ? s.trustScore.toString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
