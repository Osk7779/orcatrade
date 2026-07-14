'use client';

// Imports — customer-side list of the signed-in user's own import
// requests. L1.0 of docs/strategic-plan-2026-2031.md §4.1.2 (the
// customer-intent primitive that drives the Operator wedge).
//
// Reads:
//   GET /api/imports?mine=1  → ImportRequest[]
//
// Shape mirrors the existing /shipments and /goods list pages: an
// editorial header, a status filter, and a table. A fetch failure
// shows a friendly inline error and preserves the rest of the page.

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  apiGet,
  apiPost,
  AuthError,
  IMPORT_REQUEST_STATUSES,
  type ImportRequest,
  type ImportRequestStatus,
  type DeclineReason,
  DECLINE_REASONS,
  DECLINE_REASON_LABELS,
} from '@/lib/api';

type LoadState = 'loading' | 'auth' | 'error' | 'ready';

// Sprint 74 — bulk-archive cap. Mirrors the server-side cap in
// bulkArchiveImportRequests (lib/db/import-requests.js) so the UI
// warns BEFORE the click instead of surfacing a 400 after it —
// the sprint-20 queue posture.
const BULK_ARCHIVE_CAP = 50;

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + Math.round(cents / 100).toLocaleString('en-IE');
}

function statusLabel(s: ImportRequestStatus) {
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function statusTone(s: ImportRequestStatus): string {
  if (s === 'failed' || s === 'cancelled' || s === 'customer_rejected') return 'var(--color-critical)';
  if (s === 'customer_approved') return 'var(--color-positive)';
  if (s === 'awaiting_review' || s === 'processing') return 'var(--color-warning)';
  if (s === 'quoted') return 'var(--color-ivory)';
  return 'var(--color-ivory-mute)';
}

function ageLabel(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  const mins = Math.floor(ms / 60_000);
  if (mins >= 1) return `${mins}m ago`;
  return 'just now';
}

export default function ImportsPage() {
  return (
    <Suspense fallback={<p className="text-white/50 text-sm">Loading imports…</p>}>
      <ImportsView />
    </Suspense>
  );
}

function ImportsView() {
  const router = useRouter();
  const sp = useSearchParams();
  const filterStatus = sp.get('status') as ImportRequestStatus | null;
  // Sprint 23 — cohort drill-down from /imports/insights. When set,
  // the page renders the org-wide cohort (NOT scoped to mine=1) +
  // surfaces a cohort header. Validated against DECLINE_REASONS so
  // a forged URL falls back to null cleanly.
  const declineReasonRaw = sp.get('declineReason');
  const cohortReason: DeclineReason | null = (
    declineReasonRaw && (DECLINE_REASONS as ReadonlyArray<string>).includes(declineReasonRaw)
      ? (declineReasonRaw as DeclineReason)
      : null
  );
  // Sprint 25 — free-text search. URL-backed via ?q= so a copy-pasted
  // link reproduces the same view (matches the status + cohort
  // pattern). Trimmed at the server, capped at 200 chars on the way
  // in. Empty query string acts as "no search."
  const urlQ = (sp.get('q') || '').slice(0, 200);
  // Sprint 29 — supplier-pick cohort. The Top Picked Countries card
  // on /imports/insights links here with ?supplierPick=<ISO-2>.
  // Validated client-side too: a forged URL with garbage falls back
  // to null cleanly (the data layer would 400 a bad ISO-2 anyway).
  const supplierPickRaw = sp.get('supplierPick');
  const supplierPick: string | null = (
    typeof supplierPickRaw === 'string' && /^[A-Z]{2}$/.test(supplierPickRaw.toUpperCase())
      ? supplierPickRaw.toUpperCase()
      : null
  );
  // Sprint 76 — archived view. URL-backed (?archived=1) like every
  // other view dimension so a shared link reproduces it. The server
  // list has includeArchived (live + archived together); the
  // archived-ONLY cut happens client-side on r.archivedAt.
  const showArchived = sp.get('archived') === '1';

  const [state, setState] = useState<LoadState>('loading');
  const [requests, setRequests] = useState<ImportRequest[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  // Sprint 74 — bulk-archive selection. Set<string> keeps O(1)
  // toggle + membership (the sprint-20 queue idiom). Selection is
  // pruned (not cleared) on refetch so a filter change keeps any
  // still-visible rows selected.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  // Sprint 74 — refetch trigger after a bulk archive. Archived rows
  // fall out of the default list (archived_at IS NULL server-side),
  // so a bump here is what makes them disappear.
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Sprint 25 — local input mirror. Two-way binding URL ↔ input;
  // typing updates `searchInput` immediately for responsiveness,
  // then a 300ms debounce commits to the URL which triggers the
  // refetch. Letting the URL drive the network request keeps the
  // page reproducible from a shared link.
  const [searchInput, setSearchInput] = useState(urlQ);

  // Sprint 25 — debounce: push to URL 300ms after the last keystroke.
  // ms-to-fire is local; the URL push is what re-fires the data
  // useEffect (which reads urlQ). Idle window long enough to avoid
  // a request per keystroke, short enough that the page feels live.
  useEffect(() => {
    if (searchInput === urlQ) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (cohortReason) params.set('declineReason', cohortReason);
      if (supplierPick) params.set('supplierPick', supplierPick);
      if (searchInput.trim()) params.set('q', searchInput.trim().slice(0, 200));
      const qs = params.toString();
      router.replace(qs ? `/imports?${qs}` : '/imports');
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Keep input in sync when the URL changes from outside (e.g. clicking
  // a status chip that preserves a cohort or back-button navigation).
  useEffect(() => {
    setSearchInput(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    // Cohort drill-down is an ops view of org-wide requests; the
    // customer view stays scoped to their own. Same RBAC at the
    // handler — only ops can hit the /insights surface that
    // links here. Sprint 29 — same posture for supplierPick: when
    // present, drop mine=1 so ops sees the org-wide cohort.
    const inCohortMode = Boolean(cohortReason || supplierPick);
    if (!inCohortMode) params.set('mine', '1');
    if (filterStatus) params.set('status', filterStatus);
    if (cohortReason) params.set('declineReason', cohortReason);
    if (supplierPick) params.set('supplierPick', supplierPick);
    if (urlQ) params.set('q', urlQ);
    // Sprint 103 — archived view is a SERVER-side cut now (the
    // old client-side filter over includeArchived was wrong at
    // scale: the LIMIT ate archived rows before the client saw
    // them).
    if (showArchived) params.set('archivedOnly', '1');
    apiGet<{ ok: boolean; importRequests: ImportRequest[] }>(`/imports?${params.toString()}`)
      .then((d) => {
        if (cancelled) return;
        const all = Array.isArray(d.importRequests) ? d.importRequests : [];
        const rows = all; // server-cut both ways since sprint 103
        setRequests(rows);
        // Sprint 74 — prune (don't clear) the selection: ids that
        // fell out of the view (archived, filtered away) drop; rows
        // still visible stay selected across a filter change.
        setSelected((prev) => {
          const visible = new Set(rows.map((r) => r.externalId));
          return new Set([...prev].filter((id) => visible.has(id)));
        });
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof AuthError) setState('auth');
        else {
          setErrorMsg(err instanceof Error ? err.message : 'Could not load your import requests');
          setState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [filterStatus, cohortReason, supplierPick, urlQ, refreshNonce, showArchived]);

  const counts = useMemo(() => {
    const map: Partial<Record<ImportRequestStatus, number>> = {};
    for (const r of requests) map[r.status] = (map[r.status] || 0) + 1;
    return map;
  }, [requests]);

  // Sprint 74 — selection handlers (sprint-20 queue idioms).
  function toggleSelect(externalId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      const visibleIds = requests.map((r) => r.externalId);
      // If every visible id is already selected, treat this as a
      // "clear visible" — the same checkbox toggles both directions.
      const allSelected = visibleIds.every((id) => next.has(id));
      if (allSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds.slice(0, BULK_ARCHIVE_CAP)) next.add(id);
      }
      return next;
    });
  }

  async function submitBulkArchive() {
    if (selected.size === 0 || bulkPending) return;
    if (!confirm(`Archive ${selected.size} import request${selected.size === 1 ? '' : 's'}? Archived requests disappear from this list but stay in the audit trail.`)) return;
    setBulkPending(true);
    setBulkNotice(null);
    try {
      type BulkArchiveFailure = { externalId: string; error: string };
      const result = await apiPost<{
        ok: boolean;
        archivedCount: number;
        unchangedCount: number;
        failedCount: number;
        failed: BulkArchiveFailure[];
      }>('/imports/bulk-archive', { externalIds: [...selected] });
      // SAP-GTS batch-log posture — report the three outcomes
      // distinctly, never a collapsed "done".
      const parts = [`Archived ${result.archivedCount}`];
      if (result.unchangedCount > 0) parts.push(`${result.unchangedCount} already archived`);
      if (result.failedCount > 0) {
        const top = result.failed.slice(0, 3)
          .map((f) => `${f.externalId}: ${f.error}`).join(' · ');
        parts.push(`${result.failedCount} failed (${top})`);
      }
      setBulkNotice({ tone: result.failedCount > 0 ? 'warn' : 'ok', text: parts.join(' · ') });
      setSelected(new Set());
      setRefreshNonce((n) => n + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBulkNotice({ tone: 'warn', text: `Bulk archive failed: ${msg}` });
    } finally {
      setBulkPending(false);
    }
  }

  // Sprint 76 — archive's mirror. Same selection, same cap, same
  // three-outcome report; POSTs bulk-restore and the refetch drops
  // the restored rows out of the archived view.
  async function submitBulkRestore() {
    if (selected.size === 0 || bulkPending) return;
    if (!confirm(`Restore ${selected.size} import request${selected.size === 1 ? '' : 's'} from the archive?`)) return;
    setBulkPending(true);
    setBulkNotice(null);
    try {
      type BulkRestoreFailure = { externalId: string; error: string };
      const result = await apiPost<{
        ok: boolean;
        restoredCount: number;
        unchangedCount: number;
        failedCount: number;
        failed: BulkRestoreFailure[];
      }>('/imports/bulk-restore', { externalIds: [...selected] });
      const parts = [`Restored ${result.restoredCount}`];
      if (result.unchangedCount > 0) parts.push(`${result.unchangedCount} already live`);
      if (result.failedCount > 0) {
        const top = result.failed.slice(0, 3)
          .map((f) => `${f.externalId}: ${f.error}`).join(' · ');
        parts.push(`${result.failedCount} failed (${top})`);
      }
      setBulkNotice({ tone: result.failedCount > 0 ? 'warn' : 'ok', text: parts.join(' · ') });
      setSelected(new Set());
      setRefreshNonce((n) => n + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBulkNotice({ tone: 'warn', text: `Bulk restore failed: ${msg}` });
    } finally {
      setBulkPending(false);
    }
  }

  if (state === 'auth') {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-ivory)]">Imports</h1>
        <p className="text-[var(--color-ivory-mute)] text-sm">
          Please <a href="/account/" className="text-[var(--color-aqua)] hover:underline">sign in</a> to see your import requests.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-12 pb-16">
      {/* Hero — Inter-bold display with aqua accent, aligned to /imports/new */}
      <header className="relative pt-4">
        <div
          aria-hidden
          className="absolute -top-8 -right-8 w-64 h-64 pointer-events-none rounded-full"
          style={{
            background: 'radial-gradient(closest-side, var(--color-aqua-glow), transparent)',
            filter: 'blur(8px)',
          }}
        />
        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="space-y-4 max-w-2xl">
            <span className="inline-block text-[11px] font-semibold tracking-[0.1em] uppercase text-[var(--color-aqua)]">
              L1.0 · Operator wedge
            </span>
            <h1 className="text-[clamp(2.25rem,4.5vw,3.25rem)] font-bold text-[var(--color-ivory)] tracking-[-0.025em] leading-[1.05]">
              Your import requests.
            </h1>
            <p className="text-[var(--color-ivory-dim)] text-[16px] leading-relaxed">
              Tell us what you want from Asia. We build a factory shortlist and a fully landed-cost
              quote — duty, VAT, freight, finance, fees — one number, one accountable party.
            </p>
          </div>
          <Link
            href="/imports/new"
            className="group inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[14px] font-semibold whitespace-nowrap transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px"
            style={{
              borderRadius: 'var(--radius-button)',
              boxShadow: 'var(--shadow-cta)',
            }}
          >
            New import request
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </header>

      {/* Sprint 29 — supplier-pick cohort banner. Renders when the page
          was reached from /imports/insights via a clickable Top Picked
          Countries row. Mirrors sprint 23's cohort header pattern. */}
      {supplierPick && (
        <div
          className="bg-[var(--color-aqua-soft)] border border-[var(--color-aqua)]/30 p-5 flex items-start justify-between gap-4 flex-wrap"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <div className="space-y-1.5 max-w-2xl">
            <span className="inline-block text-[10.5px] font-semibold tracking-[0.08em] uppercase text-[var(--color-aqua)]">
              Cohort · picked country {supplierPick}
            </span>
            <p className="text-[14px] text-[var(--color-ivory)] leading-relaxed">
              Every request in your org{filterStatus ? ` at status ${statusLabel(filterStatus).toLowerCase()}` : ''} where the team materialised a pick for <span className="font-mono">{supplierPick}</span>. Use this view to learn from past corridors — the dominant rationale category tells you what drove the choice last time.
            </p>
          </div>
          <Link
            href="/imports/insights"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--color-aqua)] hover:underline shrink-0"
          >
            <span aria-hidden className="rotate-180 inline-block">→</span>
            Back to insights
          </Link>
        </div>
      )}

      {/* Sprint 23 — cohort drill-down banner. Renders when the page
          was reached from /imports/insights via a clickable decline-
          reason bar. Shows the cohort's identity + a "Back to insights"
          escape hatch so ops doesn't have to use the browser history. */}
      {cohortReason && (
        <div
          className="bg-[var(--color-aqua-soft)] border border-[var(--color-aqua)]/30 p-5 flex items-start justify-between gap-4 flex-wrap"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <div className="space-y-1.5 max-w-2xl">
            <span className="inline-block text-[10.5px] font-semibold tracking-[0.08em] uppercase text-[var(--color-aqua)]">
              Cohort · {DECLINE_REASON_LABELS[cohortReason]}
            </span>
            <p className="text-[14px] text-[var(--color-ivory)] leading-relaxed">
              Every request in your org{filterStatus ? ` at status ${statusLabel(filterStatus).toLowerCase()}` : ''} that the team declined with this reason. Triage with bulk actions on{' '}
              <Link href="/imports/queue" className="text-[var(--color-aqua)] hover:underline font-medium">
                the queue
              </Link>{' '}
              if any of these need revisiting.
            </p>
          </div>
          <Link
            href="/imports/insights"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--color-aqua)] hover:underline shrink-0"
          >
            <span aria-hidden className="rotate-180 inline-block">→</span>
            Back to insights
          </Link>
        </div>
      )}

      {/* Sprint 25 — search input. Wide pill input above the filter
          chips so it's the first interaction surface; debounced 300ms
          before pushing to the URL. URL ↔ input two-way; back-button
          + shareable links Just Work. */}
      <div className="relative">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value.slice(0, 200))}
          placeholder="Search by label, product description, or request ID…"
          aria-label="Search your import requests"
          className="w-full bg-[var(--surface-card)] border border-white/[0.08] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)] text-[14px] pl-11 pr-4 py-3 focus:border-[var(--color-aqua)] focus:outline-none transition-colors"
          style={{ borderRadius: 'var(--radius-button)' }}
        />
        <span
          aria-hidden
          className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--color-ivory-mute)] text-[14px]"
        >
          ⌕
        </span>
        {searchInput && (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-ivory-mute)] hover:text-[var(--color-aqua)] text-[14px] px-2 py-0.5 transition-colors"
          >
            ×
          </button>
        )}
      </div>

      {/* Status filter. Sprint 23: preserve the cohort drill-down on
          chip clicks so ops can narrow a cohort by status without
          losing the cohort identity. Sprint 25: same preservation
          for the active search query so a chip click inside a search
          doesn't drop it. */}
      <nav className="flex flex-wrap gap-2" aria-label="Filter by status">
        <FilterChip
          label="All"
          active={!filterStatus}
          count={requests.length}
          onClick={() => {
            const params = new URLSearchParams();
            if (cohortReason) params.set('declineReason', cohortReason);
            if (supplierPick) params.set('supplierPick', supplierPick);
            if (urlQ) params.set('q', urlQ);
            const qs = params.toString();
            router.push(qs ? `/imports?${qs}` : '/imports');
          }}
        />
        {IMPORT_REQUEST_STATUSES.map((s) => {
          const n = counts[s] || 0;
          if (n === 0 && filterStatus !== s) return null;
          return (
            <FilterChip
              key={s}
              label={statusLabel(s)}
              count={n}
              active={filterStatus === s}
              onClick={() => {
                const params = new URLSearchParams();
                params.set('status', s);
                if (cohortReason) params.set('declineReason', cohortReason);
                if (supplierPick) params.set('supplierPick', supplierPick);
                if (urlQ) params.set('q', urlQ);
                router.push(`/imports?${params.toString()}`);
              }}
              tone={statusTone(s)}
            />
          );
        })}
        {/* Sprint 76 — archived-view toggle. Deliberately NOT a
            FilterChip: the live view doesn't know the archived
            count, and a chip showing 0 would read as "none exist".
            Preserves every other view dimension across the flip. */}
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams();
            if (filterStatus) params.set('status', filterStatus);
            if (cohortReason) params.set('declineReason', cohortReason);
            if (supplierPick) params.set('supplierPick', supplierPick);
            if (urlQ) params.set('q', urlQ);
            if (!showArchived) params.set('archived', '1');
            const qs = params.toString();
            router.push(qs ? `/imports?${qs}` : '/imports');
          }}
          className="ml-auto text-[12.5px] font-medium text-[var(--color-ivory-mute)] hover:text-[var(--color-aqua)] transition-colors"
        >
          {showArchived ? '← Back to active requests' : 'View archived →'}
        </button>
      </nav>

      {/* Sprint 34 — Export CSV. Mirrors the current filtered view
          (status, cohort, search, supplier-pick) so ops downloads
          EXACTLY what's on screen. Capped server-side at 5000 rows;
          UTF-8 BOM + RFC-4180 escaping so Excel + Numbers open it
          cleanly without diacritic-mangling. Hidden when the list
          is empty — nothing to export. */}
      {/* Sprint 76 — hidden in the archived view: the CSV export's
          server filter can't express "archived only", so offering
          it there would download a different set than the screen
          shows. Hiding is the truthful option. */}
      {/* Sprint 103 — the export link works in the archived view
          too, now that the server can express archived-only. */}
      {state === 'ready' && requests.length > 0 && (
        <div className="flex justify-end -mt-3">
          <a
            href={(() => {
              const params = new URLSearchParams();
              if (!cohortReason && !supplierPick) params.set('mine', '1');
              if (filterStatus) params.set('status', filterStatus);
              if (cohortReason) params.set('declineReason', cohortReason);
              if (supplierPick) params.set('supplierPick', supplierPick);
              if (urlQ) params.set('q', urlQ);
              if (showArchived) params.set('archivedOnly', '1');
              const qs = params.toString();
              return qs ? `/api/imports/export.csv?${qs}` : '/api/imports/export.csv';
            })()}
            className="group inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--color-aqua)] hover:underline"
            title="Download CSV of the current view (UTF-8, RFC-4180)"
          >
            Export CSV
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-y-0.5">↓</span>
          </a>
        </div>
      )}

      {/* Sprint 74 — bulk-archive batch report. Persists after the
          refetch so "Archived 8 · 2 already archived" stays readable
          while the rows disappear from the list below. */}
      {bulkNotice && (
        <div
          className={`border p-4 flex items-start justify-between gap-4 ${
            bulkNotice.tone === 'ok'
              ? 'border-[var(--color-aqua)]/40 bg-[var(--color-aqua-soft)]'
              : 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/8'
          }`}
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <p className={`text-[13px] ${bulkNotice.tone === 'ok' ? 'text-[var(--color-ivory)]' : 'text-[var(--color-warning)]'}`}>
            {bulkNotice.text}
          </p>
          <button
            type="button"
            onClick={() => setBulkNotice(null)}
            aria-label="Dismiss"
            className="text-[var(--color-ivory-mute)] hover:text-[var(--color-aqua)] text-[14px] px-1 transition-colors"
          >
            ×
          </button>
        </div>
      )}

      {/* Sprint 74 — bulk action bar. Appears only when at least one
          row is selected; over-cap warning renders BEFORE the click
          (the server enforces the same 50-row cap independently). */}
      {state === 'ready' && selected.size > 0 && (
        <div
          className="bg-[var(--color-aqua-soft)] border border-[var(--color-aqua)]/40 p-4 flex items-center justify-between gap-4 flex-wrap"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <div className="text-[13.5px] text-[var(--color-ivory)]">
            <span className="font-semibold">{selected.size} selected</span>
            {selected.size > BULK_ARCHIVE_CAP && (
              <span className="ml-3 text-[var(--color-critical)] font-medium text-[12.5px]">
                ⚠ Server cap is {BULK_ARCHIVE_CAP} — drop {selected.size - BULK_ARCHIVE_CAP} before archiving.
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={bulkPending}
              className="text-[12px] font-medium text-[var(--color-ivory-mute)] hover:text-[var(--color-aqua)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear selection
            </button>
            <button
              type="button"
              onClick={showArchived ? submitBulkRestore : submitBulkArchive}
              disabled={bulkPending || selected.size > BULK_ARCHIVE_CAP}
              className="px-4 py-2 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[13px] font-semibold transition-all duration-200 hover:bg-[var(--color-aqua-dim)] disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ borderRadius: 'var(--radius-button)' }}
            >
              {/* Sprint 76 — the same bar drives both directions:
                  archive in the live view, restore in the archived
                  view. One selection model, two mirrored actions. */}
              {bulkPending
                ? (showArchived ? 'Restoring…' : 'Archiving…')
                : (showArchived ? `Restore ${selected.size}` : `Archive ${selected.size}`)}
            </button>
          </div>
        </div>
      )}

      {/* Table or empty state */}
      {state === 'loading' && <p className="text-[var(--color-ivory-mute)] text-sm">Loading…</p>}
      {state === 'error' && (
        <div
          className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/8 p-5"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <p className="text-[13px] font-semibold text-[var(--color-critical)]">Could not load requests</p>
          <p className="text-[var(--color-ivory-dim)] text-[14px] mt-1">{errorMsg}</p>
        </div>
      )}
      {state === 'ready' && requests.length === 0 && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] p-12 text-center"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          {/* Sprint 25 — search-empty state takes precedence over
              cohort + default copy. A user who typed in the search
              box should see "no matches" not "submit a new request". */}
          {/* Sprint 76 — archived-empty branch outranks the others
              (a user who flipped to the archived view should see
              "nothing archived", not "submit a new request"). */}
          {showArchived && !urlQ ? (
            <>
              <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">No archived requests.</p>
              <p className="text-[var(--color-ivory-mute)] text-[14px] mt-3 max-w-md mx-auto leading-relaxed">
                Requests archived from the list land here and can be restored at any time —
                archiving is never a one-way door.
              </p>
            </>
          ) : urlQ ? (
            <>
              <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">No matches for "{urlQ}".</p>
              <p className="text-[var(--color-ivory-mute)] text-[14px] mt-3 max-w-md mx-auto leading-relaxed">
                Try a different keyword, drop the filter, or{' '}
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="text-[var(--color-aqua)] hover:underline font-medium"
                >
                  clear the search
                </button>
                .
              </p>
            </>
          ) : /* Sprint 29 — empty supplier-pick cohort (no requests
              ever materialised for that country). */
          supplierPick ? (
            <>
              <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">No picks for {supplierPick} in this cohort.</p>
              <p className="text-[var(--color-ivory-mute)] text-[14px] mt-3 max-w-md mx-auto leading-relaxed">
                Either no requests materialised with this country picked
                {filterStatus ? ` at status ${statusLabel(filterStatus).toLowerCase()}` : ''}, or the picks fell outside the displayed window.{' '}
                <Link className="text-[var(--color-aqua)] hover:underline" href="/imports/insights">
                  Back to insights
                </Link>
                .
              </p>
            </>
          ) : /* Sprint 23 — different empty-state copy when ops is
              drilling into a cohort that turned out empty. */
          cohortReason ? (
            <>
              <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">No requests in this cohort.</p>
              <p className="text-[var(--color-ivory-mute)] text-[14px] mt-3 max-w-md mx-auto leading-relaxed">
                No declines with reason{' '}
                <span className="text-[var(--color-ivory)] font-semibold">{DECLINE_REASON_LABELS[cohortReason]}</span>
                {filterStatus ? ` and status ${statusLabel(filterStatus).toLowerCase()}` : ''} in this org{' '}
                — that's actually good news.{' '}
                <Link className="text-[var(--color-aqua)] hover:underline" href="/imports/insights">
                  Back to insights
                </Link>
                .
              </p>
            </>
          ) : (
            <>
              <p className="font-serif italic text-[var(--color-ivory-dim)] text-lg">No import requests yet.</p>
              <p className="text-[var(--color-ivory-mute)] text-[14px] mt-3">
                Start with <Link className="text-[var(--color-aqua)] hover:underline" href="/imports/new">a new request</Link> — we will surface a shortlist + landed-cost quote within a few minutes.
              </p>
            </>
          )}
        </div>
      )}
      {state === 'ready' && requests.length > 0 && (
        <div
          className="border border-white/[0.06] bg-[var(--surface-card)] overflow-hidden"
          style={{ borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-card)' }}
        >
          <table className="w-full text-left text-[14px]">
            <thead className="bg-white/[0.02] text-[var(--color-ivory-mute)]">
              <tr>
                {/* Sprint 74 — select-all-visible. The header
                    checkbox toggles both directions: all visible
                    selected → clears them. */}
                <th className="pl-5 pr-1 py-3.5 w-8">
                  <input
                    type="checkbox"
                    aria-label={`Select all ${requests.length} visible requests`}
                    checked={requests.length > 0 && requests.every((r) => selected.has(r.externalId))}
                    onChange={selectAllVisible}
                    disabled={bulkPending}
                    className="accent-[var(--color-aqua)] cursor-pointer"
                  />
                </th>
                <Th>Label</Th>
                <Th>Product</Th>
                <Th>Route</Th>
                <Th>Status</Th>
                <Th align="right">Landed total</Th>
                <Th align="right">Updated</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr
                  key={r.externalId}
                  className={`border-t border-white/[0.04] transition-colors ${
                    selected.has(r.externalId) ? 'bg-[var(--color-aqua-soft)]' : 'hover:bg-white/[0.025]'
                  }`}
                >
                  {/* Sprint 74 — per-row checkbox */}
                  <td className="pl-5 pr-1 py-4 align-top w-8">
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.label}`}
                      checked={selected.has(r.externalId)}
                      onChange={() => toggleSelect(r.externalId)}
                      disabled={bulkPending}
                      className="accent-[var(--color-aqua)] cursor-pointer"
                    />
                  </td>
                  <Td>
                    <Link
                      href={`/imports/${r.externalId}`}
                      className="text-[var(--color-ivory)] font-medium hover:text-[var(--color-aqua)] transition-colors"
                    >
                      {r.label}
                    </Link>
                    <div className="text-[11px] text-[var(--color-ivory-mute)]/70 mt-1 font-mono">
                      {r.externalId}
                    </div>
                  </Td>
                  <Td>
                    <span className="text-[var(--color-ivory-dim)] line-clamp-2">{r.productDescription}</span>
                  </Td>
                  <Td>
                    <span className="font-mono text-[12.5px] text-[var(--color-ivory-dim)]">
                      {(r.originCountry || '?')} → {r.destinationCountry}
                    </span>
                  </Td>
                  <Td>
                    <span
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium"
                      style={{ color: statusTone(r.status) }}
                    >
                      <span
                        aria-hidden
                        className="inline-block w-1.5 h-1.5"
                        style={{ background: statusTone(r.status), borderRadius: '999px' }}
                      />
                      {statusLabel(r.status)}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="text-[14px] text-[var(--color-ivory)] font-semibold tabular-nums">
                      {eurFromCents(r.landedQuote?.totalLandedCents ?? null)}
                    </span>
                  </Td>
                  <Td align="right">
                    <span className="text-[12px] text-[var(--color-ivory-mute)] tabular-nums">
                      {ageLabel(r.updatedAt)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note */}
      <footer className="border-t border-white/[0.06] pt-6 text-[var(--color-ivory-mute)] text-[12.5px] font-serif italic max-w-2xl leading-relaxed">
        v1 of the Operator wedge ships the customer-intent + AI-shortlist + calculator-grounded
        quote flow. Fulfilment (factory comms, customs filing, freight booking, finance) is run
        by the OrcaTrade team behind the curtain until partner integrations land in a later sprint.
      </footer>
    </section>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  tone,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative px-4 py-1.5 text-[12.5px] font-medium border transition-all duration-200 ${
        active
          ? 'border-[var(--color-aqua)] text-[var(--color-navy)] bg-[var(--color-aqua)] shadow-[0_2px_12px_rgba(34,211,238,0.3)]'
          : 'border-white/[0.08] text-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)] hover:border-[var(--color-aqua)]/50 hover:bg-white/[0.025]'
      }`}
      style={{ borderRadius: 'var(--radius-badge)' }}
    >
      {tone && !active && (
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5 mr-2 align-middle"
          style={{ background: tone, borderRadius: '999px' }}
        />
      )}
      {label}
      <span className={`ml-2 tabular-nums ${active ? 'text-[var(--color-navy)]/70' : 'text-[var(--color-ivory-mute)]/70'}`}>
        {count}
      </span>
    </button>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return (
    <th
      className={`px-5 py-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' | 'left' }) {
  return (
    <td className={`px-5 py-4 align-top ${align === 'right' ? 'text-right' : ''}`}>{children}</td>
  );
}
