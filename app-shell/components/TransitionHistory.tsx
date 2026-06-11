'use client';

// TransitionHistory — per-entity audit timeline. Renders the events
// captured by lib/db/<entity>.js (created → updated → status
// transitions → exception/archive) in chronological order, polymorphic
// on `entityKind`.
//
// The data layer guarantees one event per mutation (ADR 0005:
// audit-log writes precede the success response). Surfacing those
// events here turns silent compliance into customer-visible
// provenance — every state change is attributable and time-stamped.
//
// Polymorphism: entityKind = 'shipment' | 'goods' | 'supplier'. The
// component looks up the right URL prefix, headline copy, and tone
// per entity kind via the LOOKUP_BY_KIND table. New entity kinds add
// one entry to that table + extend the AuditTimelineEvent union in
// lib/api.ts — no per-page wiring beyond passing the new entityKind
// prop.
//
// Reads:
//   shipment  → GET /api/shipments/<externalId>/history
//   goods     → GET /api/goods/<externalId>/history
//   supplier  → GET /api/suppliers/<externalId>/history
//
// Best-effort: a fetch failure shows a friendly inline error rather
// than breaking the surrounding detail page.

import { useEffect, useState } from 'react';
import {
  apiGet,
  AuthError,
  type AuditTimelineEvent,
  type AuditTimelineEventType,
} from '@/lib/api';

export type EntityKind = 'shipment' | 'goods' | 'supplier';

function fmtDateTime(d: string) {
  try { return new Date(d).toLocaleString('en-IE'); } catch { return d; }
}

// Per-entity-kind config: pluralised URL segment + headline + tone
// lookups. Each entity's audit-event types live in a closed taxonomy,
// so the unmatched-default ("Status transition" / String(e.type)) only
// fires if the server starts emitting a type the UI doesn't know
// about yet — at which point the wrapper still renders something
// meaningful instead of blowing up.
const LOOKUP_BY_KIND: Record<EntityKind, {
  urlPath: string;
  headline: (e: AuditTimelineEvent) => string;
  tone: (t: AuditTimelineEventType) => string;
}> = {
  shipment: {
    urlPath: 'shipments',
    headline: (e) => {
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
    },
    tone: (t) => {
      if (t === 'shipment_master_exception_acknowledged') return 'var(--color-warning)';
      if (t === 'shipment_master_archived') return 'var(--color-ivory-mute)';
      if (t === 'shipment_master_status_transition') return 'var(--color-positive)';
      return 'var(--color-ivory)';
    },
  },
  goods: {
    urlPath: 'goods',
    headline: (e) => {
      switch (e.type) {
        case 'goods_master_created':
          return 'Goods record created';
        case 'goods_master_updated':
          return 'Goods record updated';
        case 'goods_master_archived':
          return 'Goods record archived';
        default:
          return String(e.type);
      }
    },
    tone: (t) => {
      if (t === 'goods_master_archived') return 'var(--color-ivory-mute)';
      if (t === 'goods_master_updated') return 'var(--color-positive)';
      return 'var(--color-ivory)';
    },
  },
  supplier: {
    urlPath: 'suppliers',
    headline: (e) => {
      switch (e.type) {
        case 'supplier_master_created':
          return 'Supplier record created';
        case 'supplier_master_updated':
          return 'Supplier record updated';
        case 'supplier_master_rescreened': {
          // The data layer writes a tight diff: only the three
          // sanctions fields. Show the new sanctions status in the
          // headline so the timeline reads at a glance ("Re-screened
          // → clear" vs "Re-screened → potential match").
          const to = (e.after as { sanctionsLastStatus?: string } | undefined)?.sanctionsLastStatus;
          if (to) return `Re-screened → ${to.replace(/_/g, ' ')}`;
          return 'Sanctions re-screened';
        }
        case 'supplier_master_archived':
          return 'Supplier record archived';
        default:
          return String(e.type);
      }
    },
    tone: (t) => {
      if (t === 'supplier_master_archived') return 'var(--color-ivory-mute)';
      // Re-screen tone: deliberately ambiguous (warning amber) —
      // the operator should READ the headline ("Re-screened →
      // potential match" vs "→ clear") rather than tone-glance.
      if (t === 'supplier_master_rescreened') return 'var(--color-warning)';
      if (t === 'supplier_master_updated') return 'var(--color-positive)';
      return 'var(--color-ivory)';
    },
  },
};

type LoadState = 'loading' | 'auth' | 'error' | 'empty' | 'ready';

export function TransitionHistory({
  externalId,
  entityKind = 'shipment',
}: {
  externalId: string;
  // Defaults to 'shipment' to preserve the original PR #108 call site
  // (shipments [externalId]/page.tsx passes no entityKind prop).
  entityKind?: EntityKind;
}) {
  const [state, setState] = useState<LoadState>('loading');
  const [list, setList] = useState<AuditTimelineEvent[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const cfg = LOOKUP_BY_KIND[entityKind];

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; events: AuditTimelineEvent[] }>(
      `/${cfg.urlPath}/${encodeURIComponent(externalId)}/history`,
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
  }, [externalId, cfg.urlPath]);

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
            <TimelineRow
              key={`${e.type}-${e.at}-${i}`}
              event={e}
              headline={cfg.headline(e)}
              tone={cfg.tone(e.type)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function TimelineRow({
  event,
  headline,
  tone,
}: {
  event: AuditTimelineEvent;
  headline: string;
  tone: string;
}) {
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
