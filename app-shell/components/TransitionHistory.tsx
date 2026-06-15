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
// PR #151 added batching for runs of consecutive same-actor same-type
// events. A maintenance run that updates 8 goods records in 2 minutes
// would otherwise spam 8 identical rows; the batch collapses them to
// one summary row with an expandable per-event list. Conservative
// thresholds (MIN_BATCH_SIZE=3, MAX_BATCH_GAP_MS=1h, same actor +
// same type) so the timeline never hides genuine diversity.
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

export type EntityKind = 'shipment' | 'goods' | 'supplier' | 'import_request';

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
  // Sprint 7 — fourth entity kind. Import requests fire a small set of
  // events; the load-bearing one is `import_request_status_transition`,
  // which carries `before.status` → `after.status` in the standard
  // shape so the timeline reads as "Status submitted → processing", etc.
  import_request: {
    urlPath: 'imports',
    headline: (e) => {
      switch (e.type) {
        case 'import_request_created':
          return 'Request created · status submitted';
        case 'import_request_status_transition': {
          const from = (e.before as { status?: string } | undefined)?.status;
          const to = (e.after as { status?: string } | undefined)?.status;
          // The transition detail block sometimes carries a `subtype`
          // that names the artefact attached at this transition —
          // 'shortlist_and_quote_attached', 'team_reviewed',
          // 'customer_decided'. Surface it in the headline so the
          // timeline reads as a story: not just "processing →
          // awaiting_review" but "shortlist + quote attached".
          const subtype = (e.detail as { subtype?: string } | undefined)?.subtype;
          const subtypeLabel: Record<string, string> = {
            shortlist_and_quote_attached: 'shortlist + quote attached',
            team_reviewed: 'team reviewed',
            customer_decided: 'customer decided',
          };
          const subLabel = subtype && subtypeLabel[subtype];
          if (from && to && subLabel) return `${from.replace(/_/g, ' ')} → ${to.replace(/_/g, ' ')} · ${subLabel}`;
          if (from && to) return `Status ${from.replace(/_/g, ' ')} → ${to.replace(/_/g, ' ')}`;
          if (to) return `Status → ${to.replace(/_/g, ' ')}`;
          return 'Status transition';
        }
        case 'import_request_updated':
          return 'Request updated';
        case 'import_request_archived':
          return 'Request archived';
        default:
          return String(e.type);
      }
    },
    tone: (t) => {
      if (t === 'import_request_archived') return 'var(--color-ivory-mute)';
      if (t === 'import_request_status_transition') return 'var(--color-aqua)';
      if (t === 'import_request_updated') return 'var(--color-positive)';
      return 'var(--color-ivory)';
    },
    typeLabel: (t) => {
      switch (t) {
        case 'import_request_created': return 'Created';
        case 'import_request_updated': return 'Updated';
        case 'import_request_status_transition': return 'State transition';
        case 'import_request_archived': return 'Archived';
        default: return String(t);
      }
    },
  },
};

// ── PR #151: batching consecutive same-actor same-type events ─────────
//
// MIN_BATCH_SIZE: a single run-of-2 reads fine on its own; collapsing
// it adds an interaction step (expand to see) for negligible gain.
// 3 is the smallest run where the row-spam starts to bury other
// events in the timeline.
//
// MAX_BATCH_GAP_MS: 1 hour. A maintenance script that touches many
// records typically completes inside a few minutes; a span longer
// than an hour means separate operator sessions and should render
// as separate timeline entries.
export const MIN_BATCH_SIZE = 3;
export const MAX_BATCH_GAP_MS = 60 * 60 * 1000;

export type BatchedRow =
  | { kind: 'single'; event: AuditTimelineEvent }
  | {
      kind: 'batch';
      type: AuditTimelineEventType;
      actorEmailHash: string | null | undefined;
      events: AuditTimelineEvent[]; // preserved in input order
      from: string;
      to: string;
    };

export function groupConsecutiveEvents(events: AuditTimelineEvent[]): BatchedRow[] {
  if (events.length === 0) return [];

  const out: BatchedRow[] = [];
  let run: AuditTimelineEvent[] = [events[0]];

  function flush(run: AuditTimelineEvent[]) {
    if (run.length >= MIN_BATCH_SIZE) {
      // Use the run's chronological extremes as from/to. The list
      // order may be ascending or descending; sort the two endpoint
      // timestamps so "from" is always earlier than "to" in the UI.
      const firstAt = run[0].at;
      const lastAt = run[run.length - 1].at;
      const fromAt = Date.parse(firstAt) <= Date.parse(lastAt) ? firstAt : lastAt;
      const toAt = fromAt === firstAt ? lastAt : firstAt;
      out.push({
        kind: 'batch',
        type: run[0].type,
        actorEmailHash: run[0].actorEmailHash || null,
        events: run.slice(),
        from: fromAt,
        to: toAt,
      });
    } else {
      for (const e of run) {
        out.push({ kind: 'single', event: e });
      }
    }
  }

  for (let i = 1; i < events.length; i += 1) {
    const prev = run[run.length - 1];
    const cur = events[i];
    const sameType = cur.type === prev.type;
    const sameActor = (cur.actorEmailHash || null) === (prev.actorEmailHash || null);
    const within = Math.abs(Date.parse(cur.at) - Date.parse(prev.at)) <= MAX_BATCH_GAP_MS;
    if (sameType && sameActor && within) {
      run.push(cur);
    } else {
      flush(run);
      run = [cur];
    }
  }
  flush(run);
  return out;
}

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

  // PR #151: group consecutive same-type same-actor events into
  // batched rows. Applied AFTER the type filter so a filter-by-type
  // view still surfaces every individual event (the batch would be
  // mostly redundant when every event has the same type already).
  const rendered = useMemo<BatchedRow[]>(() => {
    if (filterType) return visible.map((e) => ({ kind: 'single', event: e }));
    return groupConsecutiveEvents(visible);
  }, [visible, filterType]);

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
            {rendered.map((row, i) => {
              if (row.kind === 'single') {
                const e = row.event;
                return (
                  <TimelineRow
                    key={`${e.type}-${e.at}-${i}`}
                    event={e}
                    headline={cfg.headline(e)}
                    tone={cfg.tone(e.type)}
                  />
                );
              }
              return (
                <BatchedTimelineRow
                  key={`batch-${row.type}-${row.from}-${i}`}
                  batch={row}
                  cfg={cfg}
                />
              );
            })}
          </ol>
        )
      )}
    </section>
  );
}

// PR #151: collapsed row for a run of consecutive same-type same-
// actor events. Header reads "N updates by actor abc12345 between T1
// and T2"; the operator expands to see each event in full.
function BatchedTimelineRow({
  batch,
  cfg,
}: {
  batch: Extract<BatchedRow, { kind: 'batch' }>;
  cfg: (typeof LOOKUP_BY_KIND)[EntityKind];
}) {
  const tone = cfg.tone(batch.type);
  const typeLabel = cfg.typeLabel(batch.type);
  const actorChip = batch.actorEmailHash
    ? `actor ${batch.actorEmailHash.slice(0, 8)}`
    : 'system';
  const sameInstant = batch.from === batch.to;

  return (
    <li className="grid grid-cols-[auto_1fr] gap-4">
      <div
        aria-hidden
        className="mt-1.5 h-2 w-2 rounded-full"
        style={{ backgroundColor: tone }}
      />
      <div>
        <div className="font-serif text-[14px] text-white">
          {batch.events.length} × {typeLabel}{' '}
          <span className="font-mono text-[12px] text-white/55">
            ({actorChip})
          </span>
        </div>
        <div className="font-mono text-[11px] text-white/50 mt-1">
          {sameInstant ? (
            <>at {fmtDateTime(batch.from)}</>
          ) : (
            <>
              {fmtDateTime(batch.from)} → {fmtDateTime(batch.to)}
            </>
          )}
        </div>
        <details className="mt-2 border border-[var(--color-navy-line)] inline-block">
          <summary className="cursor-pointer px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55 hover:text-white">
            Show {batch.events.length} events
          </summary>
          <ol className="px-3 py-2 space-y-3">
            {batch.events.map((e, i) => (
              <TimelineRow
                key={`${e.type}-${e.at}-${i}`}
                event={e}
                headline={cfg.headline(e)}
                tone={tone}
              />
            ))}
          </ol>
        </details>
      </div>
    </li>
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
