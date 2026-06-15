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
//
// PR #127 added a CBAM filter dropdown with URL state (?cbam=in_scope
// | out_of_scope). Pattern mirrors the shipments status filter from
// PR #125: per-bucket counts in the dropdown labels, "All (N)" option
// clears the filter, router.replace (not push), filtered-empty state
// distinct from the data-empty state.
//
// PR #135 added a bulk archive action. Operators deprecating a SKU
// line commonly need to archive 5-50 records at once; clicking
// Archive in each detail view (PR #122 path) is operationally
// expensive at scale. Pattern:
//   - Per-row checkbox column + header "select all visible" toggle
//   - Selection toolbar appears when ≥1 row selected
//   - Two-stage destructive action: first click sets "confirming"
//     state showing a Confirm/Cancel banner; second click fires
//     the per-row DELETE serially
//   - Per-row errors surface in an inline banner; successful
//     archives drop from the top-level goods state immediately
//   - Archived records remain visible in the filter "All" view by
//     default at the data layer (they carry archivedAt) but are
//     excluded from the goods list endpoint, so the list shrinks

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { apiDelete, apiGet, ApiError, AuthError, type Goods } from '@/lib/api';
import { BulkArchiveToolbar, type BulkArchiveState } from '@/components/BulkArchiveToolbar';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + (cents / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type LoadState = 'loading' | 'auth' | 'error' | 'ready';

// CBAM filter is a closed binary taxonomy. 'all' is the absence of
// filter (URL has no ?cbam= param).
type CbamFilter = 'in_scope' | 'out_of_scope';

function readCbamFilter(raw: string | null): CbamFilter | null {
  if (raw === 'in_scope' || raw === 'out_of_scope') return raw;
  return null;
}

// Default export wraps the view in Suspense — Next.js 15 requires it
// whenever a client component uses useSearchParams (PR #125 set this
// precedent on the shipments page).
export default function GoodsListPage() {
  return (
    <Suspense fallback={<p className="text-white/50 text-sm">Loading goods…</p>}>
      <GoodsListView />
    </Suspense>
  );
}

function GoodsListView() {
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

  return (
    <div className="max-w-5xl">
      <h1 className="text-4xl mb-1">Goods</h1>
      <p className="font-mono text-xs text-white/45 mb-8">Per-SKU master records · L1.1</p>
      <GoodsList
        goods={goods}
        onArchived={(externalIds) => {
          // Drop archived records from the list state. The /api/goods
          // endpoint filters archived records by default, so a
          // re-fetch would yield the same list — but doing it
          // optimistically keeps the UI responsive without a second
          // round-trip.
          const archivedSet = new Set(externalIds);
          setGoods((prev) => prev.filter((g) => !archivedSet.has(g.externalId)));
        }}
      />
    </div>
  );
}

function GoodsList({
  goods,
  onArchived,
}: {
  goods: Goods[];
  onArchived: (externalIds: string[]) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeFilter = readCbamFilter(searchParams.get('cbam'));

  const cbamInCount = useMemo(() => goods.filter((g) => g.cbamInScope).length, [goods]);
  const cbamOutCount = goods.length - cbamInCount;

  const visibleGoods = useMemo(() => {
    if (!activeFilter) return goods;
    return goods.filter((g) =>
      activeFilter === 'in_scope' ? g.cbamInScope : !g.cbamInScope,
    );
  }, [goods, activeFilter]);

  function setFilter(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!next) {
      params.delete('cbam');
    } else {
      params.set('cbam', next);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // ── Selection + bulk archive state ─────────────────────────────────

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [archiveState, setArchiveState] = useState<BulkArchiveState>({ kind: 'idle' });

  // Drop selections that no longer match a visible row whenever the
  // displayed list changes (filter toggled, archive succeeded, etc.).
  // Without this, an archived row's externalId would linger in
  // selectedIds and confuse the "select all visible" indeterminate
  // logic.
  useEffect(() => {
    const visibleIds = new Set(visibleGoods.map((g) => g.externalId));
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
  }, [visibleGoods]);

  // Header checkbox: 'none' | 'some' | 'all'. The 'some' state drives
  // the indeterminate visual indicator on the master checkbox.
  const headerState: 'none' | 'some' | 'all' = useMemo(() => {
    if (selectedIds.size === 0) return 'none';
    if (selectedIds.size === visibleGoods.length && visibleGoods.length > 0) return 'all';
    return 'some';
  }, [selectedIds.size, visibleGoods.length]);

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
      if (prev.size === visibleGoods.length && visibleGoods.length > 0) {
        return new Set();
      }
      return new Set(visibleGoods.map((g) => g.externalId));
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setArchiveState({ kind: 'idle' });
  }

  // Serial DELETE per selected row. The /api/goods/<id> DELETE
  // endpoint is the archive path (lib/db/goods.js archiveGoods).
  // Serial (not parallel) keeps the audit log readable — one
  // goods_master_archived event per record in order — and avoids
  // pile-on on the org rate-limit if the operator selects 50+ rows.
  async function runBulkArchive() {
    setArchiveState({ kind: 'archiving' });
    const failures = new Map<string, string>();
    const succeeded: string[] = [];

    for (const externalId of selectedIds) {
      try {
        await apiDelete<{ ok: boolean; goods: Goods }>(
          `/goods/${encodeURIComponent(externalId)}`,
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
      // All succeeded — clear selection state and exit confirming
      // flow. The parent removed archived records from goods, so
      // the table re-renders without them.
      clearSelection();
    }
  }

  // ── Top-level empty state (no records at all) ────────────────────

  if (goods.length === 0) {
    return (
      <section className="border border-[var(--color-navy-line)] p-6">
        <h2 className="font-serif text-xl mb-1">No goods saved yet</h2>
        <p className="font-mono text-xs text-white/45 mt-2">
          Build your import plan in the{' '}
          <Link href="/start" className="underline">wizard</Link>{' '}
          with a SKU. Saved plans become inherited goods entries that
          future shipments draw classification from automatically.
        </p>
      </section>
    );
  }

  return (
    <section className="border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-serif text-xl">All goods</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
              Filter
            </span>
            <select
              value={activeFilter || ''}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter goods by CBAM scope"
              className="bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-white focus:outline-none focus:border-white/55"
            >
              <option value="">All ({goods.length})</option>
              <option value="in_scope">CBAM in scope ({cbamInCount})</option>
              <option value="out_of_scope">CBAM out of scope ({cbamOutCount})</option>
            </select>
          </label>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
            {activeFilter
              ? `${visibleGoods.length} of ${goods.length}`
              : `${goods.length} total · ${cbamInCount} CBAM-in-scope`}
          </span>
        </div>
      </div>

      {/* Selection toolbar — visible when ≥1 row selected. Sits
          between the section header and the table so it doesn't
          shift table layout. */}
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

      {visibleGoods.length === 0 ? (
        <p className="px-6 py-8 font-mono text-xs text-white/45">
          No goods matching this filter.{' '}
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
                  aria-label="Select all visible goods"
                  checked={headerState === 'all'}
                  ref={(el) => {
                    // Indeterminate is a DOM-only property; React's
                    // controlled-input rendering doesn't expose it.
                    // Setting via ref on every render is the
                    // canonical pattern.
                    if (el) el.indeterminate = headerState === 'some';
                  }}
                  onChange={toggleAll}
                  className="h-4 w-4"
                />
              </th>
              <th className="px-6 py-3 font-normal">SKU</th>
              <th className="px-2 py-3 font-normal">Display name</th>
              <th className="px-2 py-3 font-normal">HS code</th>
              <th className="px-2 py-3 font-normal">Origin</th>
              <th className="px-2 py-3 font-normal">CBAM</th>
              <th className="px-6 py-3 font-normal text-right">Typical value</th>
            </tr>
          </thead>
          <tbody>
            {visibleGoods.map((g) => {
              const isSelected = selectedIds.has(g.externalId);
              const failure = archiveState.kind === 'error' ? archiveState.failures.get(g.externalId) : undefined;
              return (
                <tr
                  key={g.externalId}
                  className="border-t border-[var(--color-navy-line)] hover:bg-[var(--color-navy-soft)]/30 transition-colors"
                  style={isSelected ? { backgroundColor: 'rgba(255,255,255,0.04)' } : undefined}
                >
                  <td className="px-4 py-4 w-[44px]">
                    <input
                      type="checkbox"
                      aria-label={`Select ${g.sku}`}
                      checked={isSelected}
                      onChange={() => toggleRow(g.externalId)}
                      disabled={archiveState.kind === 'archiving'}
                      className="h-4 w-4"
                    />
                  </td>
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

// BulkArchiveToolbar promoted to a shared component in PR #138 —
// see app-shell/components/BulkArchiveToolbar.tsx. The local
// definition was duplicated across goods, suppliers, and shipments
// list pages.
