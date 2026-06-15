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
//
// PR #136 added a bulk archive action — mirror of PR #135 on the
// goods list. Same three-state header checkbox, two-stage destructive
// confirmation, serial DELETE per row, per-row error surfacing.
// Operators offboarding a multi-entity supplier (a parent company
// with several legal entities) commonly need to archive a handful at
// once; clicking through detail pages doesn't scale.

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  apiDelete,
  apiGet,
  ApiError,
  AuthError,
  SUPPLIER_SANCTIONS_STATUSES,
  type Supplier,
  type SupplierSanctionsStatus,
} from '@/lib/api';
import { BulkArchiveToolbar, type BulkArchiveState } from '@/components/BulkArchiveToolbar';

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
      <SuppliersList
        suppliers={suppliers}
        onArchived={(externalIds) => {
          // Drop archived records from list state. /api/suppliers
          // filters archived records by default, so a re-fetch would
          // yield the same list — optimistic mutation keeps the UI
          // responsive without a second round-trip. Same pattern as
          // PR #135 on goods.
          const archivedSet = new Set(externalIds);
          setSuppliers((prev) => prev.filter((s) => !archivedSet.has(s.externalId)));
        }}
      />
    </div>
  );
}

// BulkArchiveState + BulkArchiveToolbar promoted to a shared
// component in PR #138 — see @/components/BulkArchiveToolbar.

function SuppliersList({
  suppliers,
  onArchived,
}: {
  suppliers: Supplier[];
  onArchived: (externalIds: string[]) => void;
}) {
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

  // ── Selection + bulk archive state ─────────────────────────────────
  // Mirror of PR #135's goods bulk archive. Same three-state checkbox
  // semantics, two-stage destructive confirmation, serial DELETE per
  // row, per-row error surfacing.

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [archiveState, setArchiveState] = useState<BulkArchiveState>({ kind: 'idle' });

  // Cleanup: drop selections that no longer match a visible row
  // (filter toggled, archive succeeded). Without this, archived
  // externalIds linger and drift the "select all visible" math.
  useEffect(() => {
    const visibleIds = new Set(visibleSuppliers.map((s) => s.externalId));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [visibleSuppliers]);

  const headerState: 'none' | 'some' | 'all' = useMemo(() => {
    if (selectedIds.size === 0) return 'none';
    if (selectedIds.size === visibleSuppliers.length && visibleSuppliers.length > 0) return 'all';
    return 'some';
  }, [selectedIds.size, visibleSuppliers.length]);

  function toggleRow(externalId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) {
        next.delete(externalId);
      } else {
        next.add(externalId);
      }
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (prev.size === visibleSuppliers.length && visibleSuppliers.length > 0) {
        return new Set();
      }
      return new Set(visibleSuppliers.map((s) => s.externalId));
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setArchiveState({ kind: 'idle' });
  }

  // Serial DELETE — see PR #135 rationale (audit log readability +
  // org rate-limit safety).
  async function runBulkArchive() {
    setArchiveState({ kind: 'archiving' });
    const failures = new Map<string, string>();
    const succeeded: string[] = [];

    for (const externalId of selectedIds) {
      try {
        await apiDelete<{ ok: boolean; supplier: Supplier }>(
          `/suppliers/${encodeURIComponent(externalId)}`,
        );
        succeeded.push(externalId);
      } catch (err) {
        if (err instanceof ApiError) {
          failures.set(externalId, err.errors[0] || err.message);
        } else if (err instanceof AuthError) {
          failures.set(externalId, 'Sign in required');
        } else {
          failures.set(externalId, err instanceof Error ? err.message : 'Archive failed');
        }
      }
    }

    if (succeeded.length > 0) {
      onArchived(succeeded);
    }
    if (failures.size > 0) {
      setArchiveState({ kind: 'error', failures });
    } else {
      clearSelection();
    }
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

      {/* Selection toolbar — visible when ≥1 row selected. Same
          layout as the goods bulk-archive toolbar from PR #135 so
          the operator workflow feels identical across SoR entities. */}
      {selectedIds.size > 0 && (
        <BulkArchiveToolbar
          selectedCount={selectedIds.size}
          archiveState={archiveState}
          onArchiveClick={() => setArchiveState({ kind: 'confirming' })}
          onConfirm={runBulkArchive}
          onCancel={() => setArchiveState({ kind: 'idle' })}
          onClear={clearSelection}
        />
      )}

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
              <th className="px-4 py-3 font-normal w-[44px]">
                <input
                  type="checkbox"
                  aria-label="Select all visible suppliers"
                  checked={headerState === 'all'}
                  ref={(el) => {
                    // Indeterminate is DOM-only; set via ref each
                    // render. Same canonical pattern as PR #135.
                    if (el) el.indeterminate = headerState === 'some';
                  }}
                  onChange={toggleAll}
                  className="h-4 w-4"
                />
              </th>
              <th className="px-6 py-3 font-normal">Entity</th>
              <th className="px-2 py-3 font-normal">HQ</th>
              <th className="px-2 py-3 font-normal">Form</th>
              <th className="px-2 py-3 font-normal">Sanctions</th>
              <th className="px-6 py-3 font-normal text-right">Trust score</th>
            </tr>
          </thead>
          <tbody>
            {visibleSuppliers.map((s) => {
              const isSelected = selectedIds.has(s.externalId);
              const failure = archiveState.kind === 'error' ? archiveState.failures.get(s.externalId) : undefined;
              return (
                <tr
                  key={s.externalId}
                  className="border-t border-[var(--color-navy-line)] hover:bg-[var(--color-navy-soft)]/30 transition-colors"
                  style={isSelected ? { backgroundColor: 'rgba(255,255,255,0.04)' } : undefined}
                >
                  <td className="px-4 py-4 w-[44px]">
                    <input
                      type="checkbox"
                      aria-label={`Select ${s.entityName}`}
                      checked={isSelected}
                      onChange={() => toggleRow(s.externalId)}
                      disabled={archiveState.kind === 'archiving'}
                      className="h-4 w-4"
                    />
                  </td>
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
                    {failure && (
                      <div
                        className="mt-1 font-mono text-[10px] text-right"
                        style={{ color: 'var(--color-critical)' }}
                      >
                        {failure}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// BulkArchiveToolbar moved to @/components/BulkArchiveToolbar in
// PR #138.
