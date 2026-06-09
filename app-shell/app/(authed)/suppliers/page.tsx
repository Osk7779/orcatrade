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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, AuthError, type Supplier, type SupplierSanctionsStatus } from '@/lib/api';

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

export default function SuppliersListPage() {
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

  const matchCount = suppliers.filter((s) =>
    s.sanctionsLastStatus === 'match' || s.sanctionsLastStatus === 'potential_match',
  ).length;

  return (
    <div className="max-w-5xl">
      <h1 className="text-4xl mb-1">Suppliers</h1>
      <p className="font-mono text-xs text-white/45 mb-8">Per-entity master records · L1.2</p>

      {suppliers.length === 0 ? (
        <section className="border border-[var(--color-navy-line)] p-6">
          <h2 className="font-serif text-xl mb-1">No suppliers saved yet</h2>
          <p className="font-mono text-xs text-white/45 mt-2">
            Suppliers are created via POST <code className="text-white/80">/api/suppliers</code>
            {' '}with entity name, HQ country, and optional registration number. Once a
            supplier exists, sanctions screening runs nightly and the trust score is
            recomputed as audits, history, and EUDR DDS evidence land.
          </p>
        </section>
      ) : (
        <section className="border border-[var(--color-navy-line)]">
          <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
            <h2 className="font-serif text-xl">All suppliers</h2>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
              {suppliers.length} total{matchCount > 0 ? ` · ${matchCount} sanctions concern` : ''}
            </span>
          </div>
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
              {suppliers.map((s) => (
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
        </section>
      )}
    </div>
  );
}
