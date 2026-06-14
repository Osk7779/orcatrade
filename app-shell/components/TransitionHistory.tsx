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
// component looks up the right URL prefix, headline copy, tone, and
// type label per entity kind via the LOOKUP_BY_KIND table. New entity
// kinds add one entry to that table + extend the AuditTimelineEvent
// union in lib/api.ts — no per-page wiring beyond passing the new
// entityKind prop.
//
// PR #134 added a client-side event-type filter. Pattern mirrors PR
// #125's URL-state status filter on the shipments list, but kept
// local-only here because:
//   - the timeline filter is a transient triage affordance, not a
//     shareable view (the detail page URL already represents the
//     entity)
//   - keeping state local avoids forcing each detail page into a
//     <Suspense> wrapper that the dynamic route segments don't have
//     today
// The filter only appears when 2+ distinct event types are present
// in the loaded list — no point filtering a single-type timeline.
//
// Reads:
//   shipment  → GET /api/shipments/<externalId>/history
//   goods     → GET /api/goods/<externalId>/history
//   supplier  → GET /api/suppliers/<externalId>/history
//
// Best-effort: a fetch failure shows a friendly inline error rather
// than breaking the surrounding detail page.

import { useEffect, useMemo, useState } from 'react';
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

// Per-entity-kind config: pluralised URL segment + headline + tone +
// typeLabel lookups. Each entity's audit-event types live in a closed
// taxonomy, so the unmatched-default ("Status transition" /
// String(e.type)) only fires if the server starts emitting a type the
// UI doesn't know about yet — at which point the wrapper still
// renders something meaningful instead of blowing up.
//
// typeLabel (PR #134) provides human-friendly names for the dropdown
// options — "Created" instead of "shipment_master_created". Keeping
// it per-entity-kind (not a generic "drop the prefix" helper) lets
// the labels stay readable when a future event type doesn't follow
// the <kind>_master_<verb> convention.
const LOOKUP_BY_KIND: Record<EntityKind, {
  urlPath: string;
  headline: (e: AuditTimelineEvent) => string;
  tone: (t: AuditTimelineEventType) => string;
  typeLabel: (t: AuditTimelineEventType) => string;
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
        case 'shipment_master_exception_acknowledged': {
          // The acknowledgement note (when the operator supplied one)
          // is the most valuable audit-trail piece — surface it in
          // the headline so timeline-scanners see WHY the exception
          // was cleared without expanding rows.
          const note = (e.detail as { note?: string | null } | undefined)?.note;
          if (note) return `Exception acknowledged · "${note}"`;
          return 'Exception acknowledged';
        }
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
    typeLabel: (t) => {
      switch (t) {
        case 'shipment_master_created': return 'Created';
        case 'shipment_master_updated': return 'Updated';
        case 'shipment_master_status_transition': return 'State transition';
        case 'shipment_master_exception_acknowledged': return 'Exception acknowledged';
        case 'shipment_master_archived': return 'Archived';
        default: return String(t);
      }
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
    typeLabel: (t) => {
      switch (t) {
        case 'goods_master_created': return 'Created';
        case 'goods_master_updated': return 'Updated';
        case 'goods_master_archived': return 'Archived';
        default: return String(t);
      }
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
    typeLabel: (t) => {
      switch (t) {
        case 'supplier_master_created': return 'Created';
        case 'supplier_master_updated': return 'Updated';
        case 'supplier_master_rescreened': return 'Re-screened';
        case 'supplier_master_archived': return 'Archived';
        default: return String(t);
      }
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
  // PR #134: client-side filter on event type. Empty string = "all".
  // Reset to '' whenever the externalId or entityKind changes so a
  // navigate-away-then-back doesn't carry stale filter state.
  const [filterType, setFilterType] = useState<string>('');

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

  // Reset filter when the entity changes (different list → different
  // type set; an old filter may not match any event).
  useEffect(() => {
    setFilterType('');
  }, [externalId, entityKind]);

  // Per-type counts computed off the FULL list (not the filtered
  // view) so dropdown labels stay stable as the user filters. Same
  // invariant as PR #125's status filter on the shipments list.
  const typeCounts = useMemo(() => {
    const map = new Map<AuditTimelineEventType, number>();
    for (const e of list) {
      map.set(e.type, (map.get(e.type) || 0) + 1);
    }
    return map;
  }, [list]);

  // Apply the filter via useMemo so re-renders don't re-filter.
  const visible = useMemo(() => {
    if (!filterType) return list;
    return list.filter((e) => e.type === filterType);
  }, [list, filterType]);

  // Only show the filter dropdown when there are ≥2 distinct types —
  // a single-type timeline has nothing to filter.
  const showFilter = state === 'ready' && typeCounts.size >= 2;

  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-serif text-xl">Audit timeline</h2>
        <div className="flex items-center gap-3">
          {showFilter && (
            <label className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/50">
                Filter
              </span>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                aria-label="Filter audit events by type"
                className="bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-2 py-1 font-mono text-[11px] uppercase tracking-[0.1em] text-white focus:outline-none focus:border-white/55"
              >
                <option value="">All types ({list.length})</option>
                {[...typeCounts.entries()]
                  .sort((a, b) => cfg.typeLabel(a[0]).localeCompare(cfg.typeLabel(b[0])))
                  .map(([t, count]) => (
                    <option key={t} value={t}>
                      {cfg.typeLabel(t)} ({count})
                    </option>
                  ))}
              </select>
            </label>
          )}
          {state === 'ready' && (
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
              {filterType
                ? `${visible.length} of ${list.length}`
                : `${list.length} event${list.length === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
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
        visible.length === 0 ? (
          // Filtered-empty (data-empty handled above). The Clear-
          // filter affordance restores the full list with one click —
          // operators recover without editing state by hand.
          <p className="px-6 py-5 font-mono text-xs text-white/45">
            No events of type &ldquo;{cfg.typeLabel(filterType as AuditTimelineEventType)}&rdquo;
            in this timeline.{' '}
            <button
              type="button"
              onClick={() => setFilterType('')}
              className="underline hover:text-white"
            >
              Clear filter
            </button>
          </p>
        ) : (
          <ol className="px-6 py-5 space-y-5">
            {visible.map((e, i) => (
              <TimelineRow
                key={`${e.type}-${e.at}-${i}`}
                event={e}
                headline={cfg.headline(e)}
                tone={cfg.tone(e.type)}
              />
            ))}
          </ol>
        )
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
