'use client';

// RelatedShipments — reverse-link panel rendered on Goods + Suppliers
// detail pages. Fetches /api/shipments filtered by the master entity's
// externalId (?goodsExternalId=… or ?supplierExternalId=…) and renders
// a compact card list.
//
// Status tone helper duplicates the one on the shipments list — kept
// here so the component is self-contained; a future refactor can lift
// it into @/lib/api alongside the brand colour helpers if a third
// surface needs it.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  apiGet,
  AuthError,
  type Shipment,
  type ShipmentStatus,
} from '@/lib/api';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + Math.round(cents / 100).toLocaleString('en-IE');
}

function statusLabel(s: ShipmentStatus) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function statusTone(s: ShipmentStatus): string {
  if (s === 'exception' || s === 'cancelled') return 'var(--color-critical)';
  if (s === 'cleared' || s === 'delivered') return 'var(--color-positive)';
  if (s === 'in_transit' || s === 'booked') return 'var(--color-warning)';
  return 'var(--color-ivory-mute)';
}

type Filter =
  | { kind: 'goods'; externalId: string }
  | { kind: 'supplier'; externalId: string };

function filterQuery(filter: Filter) {
  if (filter.kind === 'goods') return `goodsExternalId=${encodeURIComponent(filter.externalId)}`;
  return `supplierExternalId=${encodeURIComponent(filter.externalId)}`;
}

function emptyMessage(filter: Filter) {
  if (filter.kind === 'goods') return 'No shipments reference this good yet.';
  return 'No shipments reference this supplier yet.';
}

type LoadState = 'loading' | 'ready' | 'empty' | 'error' | 'auth';

export function RelatedShipments({ filter, limit = 10 }: { filter: Filter; limit?: number }) {
  const [state, setState] = useState<LoadState>('loading');
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; shipments: Shipment[] }>(
      `/shipments?${filterQuery(filter)}&limit=${limit}`,
    )
      .then((d) => {
        if (cancelled) return;
        const list = d.shipments || [];
        setShipments(list);
        setState(list.length === 0 ? 'empty' : 'ready');
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { setState('auth'); return; }
        setErrorMsg(e instanceof Error ? e.message : 'Could not load related shipments.');
        setState('error');
      });
    return () => { cancelled = true; };
  }, [filter.kind, filter.externalId, limit]);

  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl">Related shipments</h2>
        {state === 'ready' && (
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
            {shipments.length} found
          </span>
        )}
      </div>
      {state === 'loading' && (
        <p className="px-6 py-5 font-mono text-xs text-white/45">Loading…</p>
      )}
      {state === 'auth' && (
        <p className="px-6 py-5 font-mono text-xs text-white/45">Sign in to view related shipments.</p>
      )}
      {state === 'error' && (
        <p className="px-6 py-5 font-mono text-xs" style={{ color: 'var(--color-critical)' }}>
          {errorMsg}
        </p>
      )}
      {state === 'empty' && (
        <p className="px-6 py-5 font-mono text-xs text-white/45">{emptyMessage(filter)}</p>
      )}
      {state === 'ready' && (
        <ul>
          {shipments.map((s) => (
            <li
              key={s.externalId}
              className="px-6 py-3 border-t border-[var(--color-navy-line)] flex items-center justify-between gap-6 hover:bg-[var(--color-navy-soft)]/30 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/shipments/${encodeURIComponent(s.externalId)}`}
                  className="font-serif text-[14px] text-white hover:underline truncate block"
                >
                  {s.label}
                </Link>
                <div className="font-mono text-[11px] text-white/50 mt-1">
                  {(s.originCountry || '?')}→{(s.destinationCountry || '?')}
                  {' · '}
                  {eurFromCents(s.customsValueCents)}
                </div>
              </div>
              <span
                className="font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 border whitespace-nowrap"
                style={{ borderColor: statusTone(s.status), color: statusTone(s.status) }}
              >
                {statusLabel(s.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
