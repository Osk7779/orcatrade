'use client';

// Shipments dashboard — L1.6 of docs/strategic-plan-2026-2031.md §4.1.2.
//
// The operational home for the system-of-record stack. Two panels:
//   1. Exception queue card (priority — what ops needs to see first)
//   2. Shipment list table (status, route, value, links to detail)
//
// Reads:
//   GET /api/shipments/exceptions  → ExceptionQueueItem[]
//   GET /api/shipments             → Shipment[]
//
// Acts:
//   POST /api/shipments/<id>/exception/acknowledge { note? }
//
// Best-effort: a fetch failure shows a friendly inline error and
// preserves the other panel's data. The dashboard never breaks the
// signed-in surface because the new endpoints are still landing.

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  apiGet,
  apiPost,
  AuthError,
  SHIPMENT_STATUSES,
  type Shipment,
  type ExceptionQueueItem,
  type ShipmentStatus,
} from '@/lib/api';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + Math.round(cents / 100).toLocaleString('en-IE');
}

function statusLabel(s: ShipmentStatus) {
  // Title-case display. underscores → spaces.
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function statusTone(s: ShipmentStatus): string {
  // CSS-variable colour bound to each status. Cleared/delivered =
  // positive; exception/cancelled = critical; transit = warning;
  // planned/booked = neutral.
  if (s === 'exception' || s === 'cancelled') return 'var(--color-critical)';
  if (s === 'cleared' || s === 'delivered') return 'var(--color-positive)';
  if (s === 'in_transit' || s === 'booked') return 'var(--color-warning)';
  return 'var(--color-ivory-mute)';
}

function formatRoute(s: Shipment) {
  const o = s.originCountry || '?';
  const d = s.destinationCountry || '?';
  return `${o} → ${d}`;
}

function ageLabel(hours: number | null) {
  if (hours == null) return '—';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.round(hours)} h`;
  const d = Math.floor(hours / 24);
  const rem = Math.round(hours - d * 24);
  return rem ? `${d}d ${rem}h` : `${d}d`;
}

type LoadState = 'loading' | 'auth' | 'error' | 'ready';

// Default export — wraps the view in Suspense so the useSearchParams
// call inside ShipmentList (PR #125's status filter) doesn't break
// static prerendering under Next.js 15. The fallback matches the
// existing 'loading' state to avoid a UI flash during hydration.
export default function ShipmentsPage() {
  return (
    <Suspense fallback={<p className="text-white/50 text-sm">Loading shipments…</p>}>
      <ShipmentsView />
    </Suspense>
  );
}

function ShipmentsView() {
  const [state, setState] = useState<LoadState>('loading');
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [queue, setQueue] = useState<ExceptionQueueItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      apiGet<{ ok: boolean; shipments: Shipment[] }>('/shipments'),
      apiGet<{ ok: boolean; queue: ExceptionQueueItem[] }>('/shipments/exceptions'),
    ]).then((results) => {
      if (cancelled) return;
      const shipmentsResult = results[0];
      const queueResult = results[1];
      // Auth gate: a 401 on the first request flips the whole page.
      if (shipmentsResult.status === 'rejected' && shipmentsResult.reason instanceof AuthError) {
        setState('auth');
        return;
      }
      if (shipmentsResult.status === 'rejected' && queueResult.status === 'rejected') {
        setErrorMsg('Could not load shipments.');
        setState('error');
        return;
      }
      if (shipmentsResult.status === 'fulfilled') setShipments(shipmentsResult.value.shipments || []);
      if (queueResult.status === 'fulfilled') setQueue(queueResult.value.queue || []);
      setState('ready');
    });
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading shipments…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see your shipments</h1>
        <a
          href="/account/"
          className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm"
        >
          Sign in →
        </a>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">{errorMsg}</p>;

  return (
    <div className="max-w-5xl">
      <h1 className="text-4xl mb-1">Shipments</h1>
      <p className="font-mono text-xs text-white/45 mb-8">Operational system of record</p>
      <ExceptionQueueCard items={queue} onAcknowledged={(updated) => {
        setQueue((prev) => prev.map((q) => (q.externalId === updated.externalId ? { ...q, ...updated } : q)));
      }} />
      <ShipmentList shipments={shipments} />
    </div>
  );
}

function ExceptionQueueCard({
  items,
  onAcknowledged,
}: {
  items: ExceptionQueueItem[];
  onAcknowledged: (updated: ExceptionQueueItem) => void;
}) {
  const openCount = items.length;
  const breachedCount = useMemo(() => items.filter((i) => i._queue.slaBreached).length, [items]);

  if (openCount === 0) {
    return (
      <section className="mb-10 border border-[var(--color-navy-line)] p-6">
        <h2 className="font-serif text-xl mb-1">Exception queue</h2>
        <p className="font-mono text-xs text-white/45">No open exceptions. Clean operational state.</p>
      </section>
    );
  }

  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl">Exception queue</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
          {openCount} open · {breachedCount} SLA breach
        </span>
      </div>
      <ul>
        {items.slice(0, 10).map((it) => (
          <ExceptionRow key={it.externalId} item={it} onAcknowledged={onAcknowledged} />
        ))}
      </ul>
      {items.length > 10 && (
        <div className="px-6 py-3 text-[12px] text-white/45 border-t border-[var(--color-navy-line)]">
          Showing top 10 of {items.length} open exceptions.
        </div>
      )}
    </section>
  );
}

function ExceptionRow({
  item,
  onAcknowledged,
}: {
  item: ExceptionQueueItem;
  onAcknowledged: (updated: ExceptionQueueItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>('');

  async function acknowledge() {
    if (busy || item._queue.acknowledged) return;
    setBusy(true);
    setErr('');
    try {
      const res = await apiPost<{ ok: boolean; shipment: Shipment & { exceptionState?: Record<string, unknown> } }>(
        `/shipments/${encodeURIComponent(item.externalId)}/exception/acknowledge`,
        {},
      );
      onAcknowledged({
        ...item,
        ...res.shipment,
        _queue: {
          ...item._queue,
          acknowledged: true,
          acknowledgedAt: new Date().toISOString(),
        },
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not acknowledge.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-6 py-4 border-b border-[var(--color-navy-line)] last:border-b-0 grid gap-3 md:grid-cols-[1fr_auto_auto] items-center">
      <div>
        <div className="font-serif text-[15px] text-white">{item.label}</div>
        <div className="font-mono text-[11px] text-white/50 mt-1">
          {formatRoute(item)} · age {ageLabel(item._queue.ageHours)}
          {item._queue.slaBreached && (
            <span className="ml-2 text-[var(--color-critical)]">· SLA breach</span>
          )}
        </div>
      </div>
      <div className="text-right font-mono text-[11px] text-white/60">
        {item._queue.acknowledged ? 'Acknowledged' : 'Open'}
      </div>
      <button
        type="button"
        onClick={acknowledge}
        disabled={busy || item._queue.acknowledged}
        className="px-3 py-1.5 border border-[var(--color-ivory)]/30 text-[11px] font-mono uppercase tracking-[0.1em] hover:border-[var(--color-ivory)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {item._queue.acknowledged ? 'Done' : busy ? 'Acknowledging…' : 'Acknowledge'}
      </button>
      {err && <div className="md:col-span-3 text-[var(--color-critical)] text-[11px]">{err}</div>}
    </li>
  );
}

// Returns the raw search-param value when it's a valid
// ShipmentStatus, else null (treated as "all statuses"). Anything
// outside the closed taxonomy — typos, stale URLs from before a
// status was renamed, attempts to confuse the filter — is silently
// ignored rather than rendering an empty list.
function readStatusFilter(raw: string | null): ShipmentStatus | null {
  if (!raw) return null;
  return (SHIPMENT_STATUSES as ReadonlyArray<string>).includes(raw)
    ? (raw as ShipmentStatus)
    : null;
}

function ShipmentList({ shipments }: { shipments: Shipment[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL state lets operators share a triage view: "/shipments?status=exception"
  // is a working link that lands the recipient on the same filter.
  // Browser back/forward also works naturally.
  const activeFilter = readStatusFilter(searchParams.get('status'));

  const visibleShipments = useMemo(() => {
    if (!activeFilter) return shipments;
    return shipments.filter((s) => s.status === activeFilter);
  }, [shipments, activeFilter]);

  // Count per status for the dropdown labels — operators see at a
  // glance how many are in each bucket without applying the filter.
  // Computed off the FULL list (not visibleShipments) so the counts
  // don't change as the user filters.
  const countByStatus = useMemo(() => {
    const map: Partial<Record<ShipmentStatus, number>> = {};
    for (const s of shipments) {
      map[s.status] = (map[s.status] || 0) + 1;
    }
    return map;
  }, [shipments]);

  function setFilter(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!next) {
      params.delete('status');
    } else {
      params.set('status', next);
    }
    const qs = params.toString();
    // replace, not push — filter changes shouldn't pollute history.
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // Top-level empty state (org has no shipments at all). Distinct
  // from the filtered empty state below — the call-to-action only
  // makes sense pre-data.
  if (shipments.length === 0) {
    return (
      <section className="border border-[var(--color-navy-line)] p-6">
        <h2 className="font-serif text-xl mb-1">All shipments</h2>
        <p className="font-mono text-xs text-white/45 mt-2">
          No shipments yet. Promote a saved plan into a shipment from{' '}
          <Link href="/plans" className="underline">Plans</Link>{' '}
          to start the operational record.
        </p>
      </section>
    );
  }

  return (
    <section className="border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-serif text-xl">All shipments</h2>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
              Filter
            </span>
            <select
              value={activeFilter || ''}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter shipments by status"
              className="bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-white focus:outline-none focus:border-white/55"
            >
              <option value="">All statuses ({shipments.length})</option>
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)} ({countByStatus[s] || 0})
                </option>
              ))}
            </select>
          </label>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
            {activeFilter
              ? `${visibleShipments.length} of ${shipments.length}`
              : `${shipments.length} total`}
          </span>
        </div>
      </div>
      {visibleShipments.length === 0 ? (
        <p className="px-6 py-8 font-mono text-xs text-white/45">
          No shipments with status &ldquo;{statusLabel(activeFilter as ShipmentStatus)}&rdquo;.{' '}
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
              <th className="px-6 py-3 font-normal">Label</th>
              <th className="px-2 py-3 font-normal">Status</th>
              <th className="px-2 py-3 font-normal">Route</th>
              <th className="px-2 py-3 font-normal text-right">Customs value</th>
              <th className="px-6 py-3 font-normal">Updated</th>
            </tr>
          </thead>
          <tbody>
            {visibleShipments.map((s) => (
              <tr
                key={s.externalId}
                className="border-t border-[var(--color-navy-line)] hover:bg-[var(--color-navy-soft)]/30 transition-colors"
              >
                <td className="px-6 py-4 font-serif text-[14px] text-white">
                  <Link href={`/shipments/${encodeURIComponent(s.externalId)}`} className="hover:underline">
                    {s.label}
                  </Link>
                </td>
                <td className="px-2 py-4">
                  <span
                    className="font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 border"
                    style={{ borderColor: statusTone(s.status), color: statusTone(s.status) }}
                  >
                    {statusLabel(s.status)}
                  </span>
                </td>
                <td className="px-2 py-4 font-mono text-[12px] text-white/70">{formatRoute(s)}</td>
                <td className="px-2 py-4 font-mono text-[12px] text-white/70 text-right">
                  {eurFromCents(s.customsValueCents)}
                </td>
                <td className="px-6 py-4 font-mono text-[11px] text-white/50">
                  {s.updatedAt ? new Date(s.updatedAt).toLocaleDateString('en-IE') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
