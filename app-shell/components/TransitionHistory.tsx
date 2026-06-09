'use client';

// TransitionHistory — per-shipment audit timeline. Renders the events
// captured by lib/db/shipments.js (created → updated → state-transitions
// → exception → acknowledged → archived) in chronological order.
//
// The data layer guarantees one event per mutation (ADR 0005:
// audit-log writes precede the success response). Surfacing those
// events here turns silent compliance into customer-visible
// provenance — every state change is attributable and time-stamped.
//
// Reads:
//   GET /api/shipments/<externalId>/history → ShipmentTimelineEvent[]
//
// Best-effort: a fetch failure shows a friendly inline error rather
// than breaking the surrounding detail page.

import { useEffect, useState } from 'react';
import {
  apiGet,
  AuthError,
  type ShipmentTimelineEvent,
  type ShipmentTimelineEventType,
} from '@/lib/api';

function fmtDateTime(d: string) {
  try { return new Date(d).toLocaleString('en-IE'); } catch { return d; }
}

function eventHeadline(e: ShipmentTimelineEvent): string {
  switch (e.type) {
    case 'shipment_master_created':
      return 'Shipment created · status planned';
    case 'shipment_master_status_transition': {
      const from = (e.before as { status?: string } | undefined)?.status;
      const to = (e.after as { status?: string } | undefined)?.status;
      if (from && to) return `Status ${from} → ${to}`;
      if (to) return `Status → ${to}`;
      return 'Status transition';
    }
    case 'shipment_master_exception_acknowledged':
      return 'Exception acknowledged';
    case 'shipment_master_updated':
      return 'Shipment updated';
    case 'shipment_master_archived':
      return 'Shipment archived';
    default:
      return String(e.type);
  }
}

function eventTone(t: ShipmentTimelineEventType): string {
  if (t === 'shipment_master_exception_acknowledged') return 'var(--color-warning)';
  if (t === 'shipment_master_archived') return 'var(--color-ivory-mute)';
  if (t === 'shipment_master_status_transition') return 'var(--color-positive)';
  return 'var(--color-ivory)';
}

type LoadState = 'loading' | 'auth' | 'error' | 'empty' | 'ready';

export function TransitionHistory({ externalId }: { externalId: string }) {
  const [state, setState] = useState<LoadState>('loading');
  const [list, setList] = useState<ShipmentTimelineEvent[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; events: ShipmentTimelineEvent[] }>(
      `/shipments/${encodeURIComponent(externalId)}/history`,
    )
      .then((d) => {
        if (cancelled) return;
        const evs = d.events || [];
        setList(evs);
        setState(evs.length === 0 ? 'empty' : 'ready');
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { setState('auth'); return; }
        setErrorMsg(e instanceof Error ? e.message : 'Could not load history.');
        setState('error');
      });
    return () => { cancelled = true; };
  }, [externalId]);

  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl">Audit timeline</h2>
        {state === 'ready' && (
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
            {list.length} event{list.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {state === 'loading' && (
        <p className="px-6 py-5 font-mono text-xs text-white/45">Loading timeline…</p>
      )}
      {state === 'auth' && (
        <p className="px-6 py-5 font-mono text-xs text-white/45">Sign in to view the audit timeline.</p>
      )}
      {state === 'error' && (
        <p className="px-6 py-5 font-mono text-xs" style={{ color: 'var(--color-critical)' }}>{errorMsg}</p>
      )}
      {state === 'empty' && (
        <p className="px-6 py-5 font-mono text-xs text-white/45">
          No audit events yet. New transitions will appear here.
        </p>
      )}
      {state === 'ready' && (
        <ol className="px-6 py-5 space-y-5">
          {list.map((e, i) => (
            <TimelineRow key={`${e.type}-${e.at}-${i}`} event={e} />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineRow({ event }: { event: ShipmentTimelineEvent }) {
  const headline = eventHeadline(event);
  const tone = eventTone(event.type);
  return (
    <li className="grid grid-cols-[auto_1fr] gap-4">
      <div
        aria-hidden
        className="mt-1.5 h-2 w-2 rounded-full"
        style={{ backgroundColor: tone }}
      />
      <div>
        <div className="font-serif text-[14px] text-white">{headline}</div>
        <div className="font-mono text-[11px] text-white/50 mt-1">
          {fmtDateTime(event.at)}
          {event.actorEmailHash && (
            <span className="ml-2 text-white/35">· actor {event.actorEmailHash.slice(0, 8)}</span>
          )}
        </div>
        {event.detail && Object.keys(event.detail).length > 0 && (
          <details className="mt-2 border border-[var(--color-navy-line)] inline-block">
            <summary className="cursor-pointer px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55 hover:text-white">
              Detail
            </summary>
            <pre className="px-3 py-2 font-mono text-[11px] text-white/70 overflow-x-auto whitespace-pre">
              {JSON.stringify(event.detail, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </li>
  );
}
