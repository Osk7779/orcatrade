'use client';

// Goods master detail — per-SKU view. Mirrors /shipments/<id> in shape
// but with goods-specific fields (HS code, origin, REACH SVHC,
// restricted substances). No state machine.

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  apiGet,
  apiPatch,
  AuthError,
  ApiError,
  type Goods,
  type ReachSvhcFlag,
} from '@/lib/api';
import { RelatedShipments } from '@/components/RelatedShipments';
import { TransitionHistory } from '@/components/TransitionHistory';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + (cents / 100).toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IE'); } catch { return d; }
}

type LoadState = 'loading' | 'auth' | 'error' | 'notFound' | 'ready';

export default function GoodsDetailPage({ params }: { params: Promise<{ externalId: string }> }) {
  const { externalId } = use(params);
  const [state, setState] = useState<LoadState>('loading');
  const [goods, setGoods] = useState<Goods | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  // Edit mode is a top-level boolean — the form swaps in for FactsGrid
  // when editing. Save flows the updated record back up to setGoods so
  // the TransitionHistory below refreshes naturally on its next read.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; goods: Goods }>(`/goods/${encodeURIComponent(externalId)}`)
      .then((d) => { if (!cancelled) { setGoods(d.goods); setState('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { setState('auth'); return; }
        const msg = e instanceof Error ? e.message : 'Could not load goods.';
        if (/404|not found/i.test(msg)) { setState('notFound'); return; }
        setErrorMsg(msg);
        setState('error');
      });
    return () => { cancelled = true; };
  }, [externalId]);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading goods…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see this good</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'notFound') {
    return (
      <div className="max-w-xl">
        <Link href="/goods" className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45 hover:text-white">← All goods</Link>
        <h1 className="text-4xl mt-3 mb-1">Not found</h1>
        <p className="font-mono text-xs text-white/45">This good doesn't exist in your organisation, or it has been archived.</p>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">{errorMsg}</p>;
  if (!goods) return null;

  return (
    <div className="max-w-4xl">
      <Header
        goods={goods}
        editing={editing}
        onEdit={() => setEditing(true)}
      />
      {editing ? (
        <EditForm
          goods={goods}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            setGoods(updated);
            setEditing(false);
          }}
        />
      ) : (
        <FactsGrid goods={goods} />
      )}
      {/* PR #129: Panel always renders so operators can ADD an SVHC
          entry to a goods record that doesn't yet have any. The
          presence-of-data check moved INSIDE the panel (read mode
          says "No SVHCs declared yet"; edit mode lets the operator
          add the first row). */}
      <ReachSvhcPanel
        goods={goods}
        onSaved={(updated) => setGoods(updated)}
      />
      {/* PR #148: Panel always renders so operators can ADD a
          restricted-substance entry to a goods record that doesn't
          yet have any. Same key/value editor pattern as PR #133 (EUDR)
          and PR #147 (supplier.metadata). Restricted substances feed
          customs declarations + UKCA / CE marking docs, so the read-
          mode empty state surfaces the per-jurisdiction coverage gap. */}
      <RestrictedSubstancesPanel
        goods={goods}
        onSaved={(updated) => setGoods(updated)}
      />
      <RelatedShipments filter={{ kind: 'goods', externalId: goods.externalId }} />
      <TransitionHistory externalId={goods.externalId} entityKind="goods" />
    </div>
  );
}

function Header({
  goods,
  editing,
  onEdit,
}: {
  goods: Goods;
  editing: boolean;
  onEdit: () => void;
}) {
  return (
    <header className="mb-8">
      <Link href="/goods" className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45 hover:text-white">
        ← All goods
      </Link>
      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-4xl text-white">{goods.displayName}</h1>
          <p className="font-mono text-[12px] text-white/55 mt-2">
            SKU {goods.sku} · {goods.externalId}
          </p>
        </div>
        <div className="flex items-start gap-3">
          {goods.cbamInScope && (
            <span
              className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border"
              style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}
            >
              CBAM in scope
            </span>
          )}
          {!editing && !goods.archivedAt && (
            <button
              type="button"
              onClick={onEdit}
              className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/35 text-white hover:bg-white/10 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

// EditForm — inline edit mode for the scalar fields of a goods master
// record (displayName, hsCode, originCountry, typicalUnitValueCents,
// cbamInScope). The complex jsonb fields each own their own panel:
//   reachSvhcFlags          → ReachSvhcPanel (PR #129)
//   restrictedSubstances    → RestrictedSubstancesPanel (PR #148)
//   metadata                → GoodsMetadataPanel (PR #149)
// Not touched from EditForm.
//
// Validation strategy: client-side validates the shapes that
// lib/db/goods.js's validateForUpdate enforces (HS code 6-10 digits,
// ISO-2 origin, non-negative integer cents, ≤200 chars displayName).
// Server-side validation re-runs on the PATCH; any errors come back
// as ApiError.errors and render inline.
function EditForm({
  goods,
  onCancel,
  onSaved,
}: {
  goods: Goods;
  onCancel: () => void;
  onSaved: (updated: Goods) => void;
}) {
  // Cents in the DB, but humans enter euros. Two-way conversion at the
  // form boundary keeps the on-screen number familiar.
  const initialEur =
    goods.typicalUnitValueCents != null
      ? (goods.typicalUnitValueCents / 100).toFixed(2)
      : '';
  const [displayName, setDisplayName] = useState(goods.displayName);
  const [hsCode, setHsCode] = useState(goods.hsCode);
  const [originCountry, setOriginCountry] = useState(goods.originCountry || '');
  const [typicalUnitValueEur, setTypicalUnitValueEur] = useState(initialEur);
  const [cbamInScope, setCbamInScope] = useState(goods.cbamInScope);

  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function clientSideErrors(): string[] {
    const out: string[] = [];
    if (!displayName.trim()) out.push('displayName must be a non-empty string');
    else if (displayName.length > 200) out.push('displayName must be ≤200 chars');
    if (!/^\d{6,10}$/.test(hsCode.trim())) out.push('hsCode must be 6-10 digits');
    const oc = originCountry.trim().toUpperCase();
    if (oc && !/^[A-Z]{2}$/.test(oc)) out.push('originCountry must be ISO-2 uppercase');
    if (typicalUnitValueEur.trim() !== '') {
      const eur = Number(typicalUnitValueEur);
      if (!Number.isFinite(eur) || eur < 0) {
        out.push('typicalUnitValueCents must be a non-negative integer');
      }
    }
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const localErrors = clientSideErrors();
    if (localErrors.length) {
      setErrors(localErrors);
      return;
    }
    setSaving(true);
    setErrors([]);

    // Build a sparse patch — only send fields that changed. This
    // both shrinks the payload and lets the server compute a tight
    // audit-log diff. Crucially, sending typicalUnitValueCents:null
    // is distinct from "unchanged" — we only emit it when the user
    // explicitly cleared the field (initialEur set, now empty).
    /** @type {Partial<Goods>} */
    const patch: Record<string, unknown> = {};
    if (displayName !== goods.displayName) patch.displayName = displayName.trim();
    if (hsCode !== goods.hsCode) patch.hsCode = hsCode.trim();
    const ocNorm = originCountry.trim().toUpperCase();
    const ocCurrent = (goods.originCountry || '').toUpperCase();
    if (ocNorm !== ocCurrent) patch.originCountry = ocNorm || null;
    const cents =
      typicalUnitValueEur.trim() === ''
        ? null
        : Math.round(Number(typicalUnitValueEur) * 100);
    if (cents !== (goods.typicalUnitValueCents ?? null)) {
      patch.typicalUnitValueCents = cents;
    }
    if (cbamInScope !== goods.cbamInScope) patch.cbamInScope = cbamInScope;

    if (Object.keys(patch).length === 0) {
      // No changes — exit edit mode without hitting the API. Mirrors
      // the handler's own no-op short-circuit.
      setSaving(false);
      onCancel();
      return;
    }

    try {
      const d = await apiPatch<{ ok: boolean; goods: Goods; unchanged: boolean }>(
        `/goods/${encodeURIComponent(goods.externalId)}`,
        patch,
      );
      onSaved(d.goods);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors.length ? err.errors : [err.message]);
      } else if (err instanceof AuthError) {
        setErrors(['Sign in required to save changes.']);
      } else {
        setErrors([err instanceof Error ? err.message : 'Could not save changes.']);
      }
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="mb-10 border border-[var(--color-navy-line)] bg-[var(--color-ink)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl">Edit goods record</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
          SKU {goods.sku} · immutable
        </span>
      </div>

      <div className="px-6 py-6 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
        <Field
          label="Display name"
          value={displayName}
          onChange={setDisplayName}
          required
          maxLength={200}
        />
        <Field
          label="HS code"
          value={hsCode}
          onChange={setHsCode}
          required
          hint="6 to 10 digits"
          inputMode="numeric"
          pattern="\d{6,10}"
        />
        <Field
          label="Origin country"
          value={originCountry}
          onChange={(v) => setOriginCountry(v.toUpperCase())}
          hint="ISO-2 (e.g. CN, VN). Blank = unspecified."
          maxLength={2}
        />
        <Field
          label="Typical unit value (EUR)"
          value={typicalUnitValueEur}
          onChange={setTypicalUnitValueEur}
          hint="Decimal euros. Blank = unspecified."
          inputMode="decimal"
        />
        <label className="flex items-center gap-3 md:col-span-2 py-1">
          <input
            type="checkbox"
            checked={cbamInScope}
            onChange={(e) => setCbamInScope(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-mono text-[12px] text-white/85">CBAM in scope</span>
        </label>
      </div>

      {errors.length > 0 && (
        <ul
          className="border-t border-[var(--color-navy-line)] px-6 py-4 space-y-1"
          role="alert"
        >
          {errors.map((e, i) => (
            <li
              key={i}
              className="font-mono text-[12px]"
              style={{ color: 'var(--color-critical)' }}
            >
              {e}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-[var(--color-navy-line)] px-6 py-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/30 text-white/85 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 bg-white text-[var(--color-ink)] hover:bg-white/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  maxLength,
  hint,
  inputMode,
  pattern,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  maxLength?: number;
  hint?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  pattern?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
        {label}
        {required && <span className="ml-1 text-white/60">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        inputMode={inputMode}
        pattern={pattern}
        className="mt-1.5 block w-full bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-3 py-2 font-mono text-[13px] text-white focus:outline-none focus:border-white/55"
      />
      {hint && (
        <span className="block mt-1 font-mono text-[10px] text-white/40">{hint}</span>
      )}
    </label>
  );
}

function FactsGrid({ goods }: { goods: Goods }) {
  const facts = [
    { label: 'SKU', value: goods.sku },
    { label: 'HS code', value: goods.hsCode },
    { label: 'Origin', value: goods.originCountry ?? '—' },
    { label: 'Typical unit value', value: eurFromCents(goods.typicalUnitValueCents) },
    { label: 'CBAM in scope', value: goods.cbamInScope ? 'Yes' : 'No' },
    { label: 'Created', value: fmtDate(goods.createdAt) },
    { label: 'Updated', value: fmtDate(goods.updatedAt) },
    { label: 'Archived', value: goods.archivedAt ? fmtDate(goods.archivedAt) : '—' },
  ];
  return (
    <section className="mb-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-navy-line)] border border-[var(--color-navy-line)]">
      {facts.map((f) => (
        <div key={f.label} className="bg-[var(--color-ink)] px-4 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{f.label}</div>
          <div className="font-mono text-[13px] text-white mt-1.5">{f.value}</div>
        </div>
      ))}
    </section>
  );
}

// ReachSvhcPanel — read view of declared REACH SVHCs + per-row
// editor (PR #129). The panel toggles between read mode (compact
// list + "Edit" button) and edit mode (per-row inputs + add/remove +
// Save/Cancel).
//
// Why a dedicated SVHC editor (not part of EditForm): EditForm (PR
// #122) handles scalar identifying fields; SVHC editing is an
// array operation with per-row inputs that don't fit a flat form.
// Keeping it inside the panel lets operators add an SVHC without
// touching display name / HS code / etc.
//
// Validation mirrors lib/db/goods.js validateForUpdate's
// reachSvhcFlags shape: must be an array (already enforced at the
// type boundary). Per-row constraints layered on top here:
//   - Each row must have at least one of (name, cas) — a completely
//     empty row is dropped at save (treated as cancellation of that
//     row, not an error)
//   - threshold_pct, if present, must be a finite number in 0-100
//
// Server-side validation re-runs on PATCH; any errors come back as
// ApiError.errors and render inline.
function ReachSvhcPanel({
  goods,
  onSaved,
}: {
  goods: Goods;
  onSaved: (updated: Goods) => void;
}) {
  const persistedFlags = goods.reachSvhcFlags || [];
  const archived = Boolean(goods.archivedAt);
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <ReadModePanel
        flags={persistedFlags}
        archived={archived}
        onEditClick={() => setEditing(true)}
      />
    );
  }

  return (
    <SvhcEditorPanel
      goods={goods}
      initialFlags={persistedFlags}
      onCancel={() => setEditing(false)}
      onSaved={(updated) => {
        onSaved(updated);
        setEditing(false);
      }}
    />
  );
}

function ReadModePanel({
  flags,
  archived,
  onEditClick,
}: {
  flags: ReachSvhcFlag[];
  archived: boolean;
  onEditClick: () => void;
}) {
  const hasFlags = flags.length > 0;
  // Border tone: warning when there are declared SVHCs (operator
  // attention signal); muted neutral when empty (no risk to
  // highlight).
  const borderColor = hasFlags ? 'var(--color-warning)' : 'var(--color-navy-line)';
  return (
    <section className="mb-10 border" style={{ borderColor }}>
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between gap-3">
        <h2
          className="font-serif text-xl"
          style={{ color: hasFlags ? 'var(--color-warning)' : 'var(--color-ivory)' }}
        >
          REACH SVHC flags
        </h2>
        <div className="flex items-center gap-3">
          {hasFlags && (
            <span
              className="font-mono text-[11px] uppercase tracking-[0.12em]"
              style={{ color: 'var(--color-warning)' }}
            >
              {flags.length} declared
            </span>
          )}
          {!archived && (
            <button
              type="button"
              onClick={onEditClick}
              className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/35 text-white hover:bg-white/10 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      </div>
      {hasFlags ? (
        <ul>
          {flags.map((f, i) => (
            <li
              key={f.cas || `flag-${i}`}
              className="px-6 py-3 border-t border-[var(--color-navy-line)] flex items-center justify-between gap-6"
            >
              <div>
                <div className="font-serif text-[14px] text-white">
                  {f.name || f.cas || 'Unnamed SVHC'}
                </div>
                <div className="font-mono text-[11px] text-white/55 mt-1">
                  {f.cas ? `CAS ${f.cas}` : ''}
                  {f.threshold_pct != null ? ` · threshold ${f.threshold_pct}%` : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-6 py-5 font-mono text-xs text-white/45">
          No SVHCs declared yet. {!archived && 'Click Edit to add the first entry.'}
        </p>
      )}
    </section>
  );
}

// Local working type — looser than ReachSvhcFlag so the editor can
// hold string-typed inputs for threshold_pct (parsed at save time).
// Carries a stable rowKey so React reconciliation survives reorders
// and add/remove operations without losing focus or remounting
// existing rows.
type SvhcDraft = {
  rowKey: string;
  name: string;
  cas: string;
  thresholdPctRaw: string;
};

let rowKeyCounter = 0;
function nextRowKey(): string {
  rowKeyCounter += 1;
  return `svhc-${rowKeyCounter}`;
}

function flagToDraft(f: ReachSvhcFlag): SvhcDraft {
  return {
    rowKey: nextRowKey(),
    name: typeof f.name === 'string' ? f.name : '',
    cas: typeof f.cas === 'string' ? f.cas : '',
    thresholdPctRaw:
      typeof f.threshold_pct === 'number' && Number.isFinite(f.threshold_pct)
        ? String(f.threshold_pct)
        : '',
  };
}

function draftToFlag(d: SvhcDraft): ReachSvhcFlag | null {
  // Drop completely-empty rows. Treats "operator added a blank row
  // and then cancelled out of it" as a no-op rather than a validation
  // error.
  const name = d.name.trim();
  const cas = d.cas.trim();
  const thrRaw = d.thresholdPctRaw.trim();
  if (!name && !cas && !thrRaw) return null;
  const out: ReachSvhcFlag = {};
  if (name) out.name = name;
  if (cas) out.cas = cas;
  if (thrRaw !== '') {
    const n = Number(thrRaw);
    if (Number.isFinite(n)) out.threshold_pct = n;
  }
  return out;
}

// Shallow-equality check that ignores row order — two arrays of
// SVHCs are "equal" if every flag in one has a matching flag in the
// other on (name, cas, threshold_pct). Used by the no-op short-
// circuit so a re-order followed by an undo doesn't emit a no-op
// PATCH.
function flagsEqual(a: ReachSvhcFlag[], b: ReachSvhcFlag[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (f: ReachSvhcFlag) =>
    `${f.name ?? ''}|${f.cas ?? ''}|${f.threshold_pct ?? ''}`;
  const aSet = a.map(norm).sort();
  const bSet = b.map(norm).sort();
  return aSet.every((v, i) => v === bSet[i]);
}

function SvhcEditorPanel({
  goods,
  initialFlags,
  onCancel,
  onSaved,
}: {
  goods: Goods;
  initialFlags: ReachSvhcFlag[];
  onCancel: () => void;
  onSaved: (updated: Goods) => void;
}) {
  const [drafts, setDrafts] = useState<SvhcDraft[]>(() =>
    initialFlags.length > 0
      ? initialFlags.map(flagToDraft)
      : [{ rowKey: nextRowKey(), name: '', cas: '', thresholdPctRaw: '' }],
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function updateRow(rowKey: string, patch: Partial<SvhcDraft>) {
    setDrafts((prev) =>
      prev.map((d) => (d.rowKey === rowKey ? { ...d, ...patch } : d)),
    );
  }

  function removeRow(rowKey: string) {
    setDrafts((prev) => prev.filter((d) => d.rowKey !== rowKey));
  }

  function addRow() {
    setDrafts((prev) => [
      ...prev,
      { rowKey: nextRowKey(), name: '', cas: '', thresholdPctRaw: '' },
    ]);
  }

  function clientSideErrors(materialised: ReachSvhcFlag[]): string[] {
    const out: string[] = [];
    materialised.forEach((f, i) => {
      const rowNumber = i + 1;
      // A materialised row (non-empty after draftToFlag) must carry
      // at least name OR cas — anonymous threshold-only rows are
      // not auditable.
      if (!f.name && !f.cas) {
        out.push(`Row ${rowNumber}: must have a name or a CAS number`);
      }
      if (f.threshold_pct != null) {
        if (!Number.isFinite(f.threshold_pct) || f.threshold_pct < 0 || f.threshold_pct > 100) {
          out.push(`Row ${rowNumber}: threshold % must be between 0 and 100`);
        }
      }
    });
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors([]);

    // Materialise drafts → flags (drops empty rows).
    const materialised = drafts
      .map(draftToFlag)
      .filter((f): f is ReachSvhcFlag => f !== null);

    const localErrors = clientSideErrors(materialised);
    if (localErrors.length) {
      setErrors(localErrors);
      setSaving(false);
      return;
    }

    // No-op short-circuit: if the materialised array matches the
    // persisted one (ignoring order), exit without firing a PATCH.
    if (flagsEqual(materialised, initialFlags)) {
      setSaving(false);
      onCancel();
      return;
    }

    try {
      const d = await apiPatch<{ ok: boolean; goods: Goods; unchanged: boolean }>(
        `/goods/${encodeURIComponent(goods.externalId)}`,
        { reachSvhcFlags: materialised },
      );
      onSaved(d.goods);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors.length ? err.errors : [err.message]);
      } else if (err instanceof AuthError) {
        setErrors(['Sign in required to save SVHC changes.']);
      } else {
        setErrors([err instanceof Error ? err.message : 'Could not save SVHC changes.']);
      }
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-10 border bg-[var(--color-ink)]"
      style={{ borderColor: 'var(--color-warning)' }}
    >
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl" style={{ color: 'var(--color-warning)' }}>
          Edit REACH SVHC flags
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
          {drafts.length} {drafts.length === 1 ? 'row' : 'rows'}
        </span>
      </div>

      <div className="px-6 py-5 space-y-4">
        {drafts.map((d, i) => (
          <SvhcEditRow
            key={d.rowKey}
            index={i}
            draft={d}
            disabled={saving}
            onChange={(patch) => updateRow(d.rowKey, patch)}
            onRemove={() => removeRow(d.rowKey)}
          />
        ))}
        <button
          type="button"
          onClick={addRow}
          disabled={saving}
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/35 text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          + Add SVHC
        </button>
      </div>

      {errors.length > 0 && (
        <ul
          className="border-t border-[var(--color-navy-line)] px-6 py-4 space-y-1"
          role="alert"
        >
          {errors.map((e, i) => (
            <li
              key={i}
              className="font-mono text-[12px]"
              style={{ color: 'var(--color-critical)' }}
            >
              {e}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-[var(--color-navy-line)] px-6 py-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/30 text-white/85 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 bg-white text-[var(--color-ink)] hover:bg-white/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save SVHC list'}
        </button>
      </div>
    </form>
  );
}

function SvhcEditRow({
  index,
  draft,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  draft: SvhcDraft;
  disabled: boolean;
  onChange: (patch: Partial<SvhcDraft>) => void;
  onRemove: () => void;
}) {
  const rowNumber = index + 1;
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_180px_120px_auto] items-start border border-[var(--color-navy-line)] px-3 py-3">
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
          Name <span className="text-white/35">(row {rowNumber})</span>
        </span>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={disabled}
          maxLength={200}
          placeholder="e.g. Bisphenol A"
          className="mt-1.5 block w-full bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-3 py-1.5 font-mono text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/45 disabled:opacity-50"
        />
      </label>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
          CAS number
        </span>
        <input
          type="text"
          value={draft.cas}
          onChange={(e) => onChange({ cas: e.target.value })}
          disabled={disabled}
          maxLength={32}
          placeholder="80-05-7"
          className="mt-1.5 block w-full bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-3 py-1.5 font-mono text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/45 disabled:opacity-50"
        />
      </label>
      <label className="block">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
          Threshold %
        </span>
        <input
          type="text"
          value={draft.thresholdPctRaw}
          onChange={(e) => onChange({ thresholdPctRaw: e.target.value })}
          disabled={disabled}
          inputMode="decimal"
          placeholder="0.1"
          className="mt-1.5 block w-full bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-3 py-1.5 font-mono text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/45 disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove SVHC row ${rowNumber}`}
        className="self-end font-mono text-[11px] px-3 py-1.5 border border-white/25 text-white/70 hover:text-white hover:border-white/45 disabled:opacity-50 transition-colors"
      >
        ×
      </button>
    </div>
  );
}

// RestrictedSubstancesPanel — read view + key/value editor for the
// goods.restrictedSubstances jsonb object (PR #148). Third jsonb-OBJECT
// editor on the platform after PR #133 (EUDR) and PR #147 (supplier
// metadata).
//
// Restricted substances are per-jurisdiction notes (UK_REACH, EU_RoHS,
// CA_Prop65, etc.) that feed customs declarations + UKCA/CE marking
// documentation. The shape is open — auditors collect different fields
// per jurisdiction — so a flat key/value editor fits better than a
// fixed schema. Same draft + materialisation + validation pattern as
// PRs #133 / #147.
function RestrictedSubstancesPanel({
  goods,
  onSaved,
}: {
  goods: Goods;
  onSaved: (updated: Goods) => void;
}) {
  const persistedSubs = (goods.restrictedSubstances || {}) as Record<string, unknown>;
  const archived = Boolean(goods.archivedAt);
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <RestrictedSubstancesReadPanel
        subs={persistedSubs}
        archived={archived}
        onEditClick={() => setEditing(true)}
      />
    );
  }

  return (
    <RestrictedSubstancesEditorPanel
      goods={goods}
      initialSubs={persistedSubs}
      onCancel={() => setEditing(false)}
      onSaved={(updated) => {
        onSaved(updated);
        setEditing(false);
      }}
    />
  );
}

function RestrictedSubstancesReadPanel({
  subs,
  archived,
  onEditClick,
}: {
  subs: Record<string, unknown>;
  archived: boolean;
  onEditClick: () => void;
}) {
  const entries = Object.entries(subs);
  const hasEntries = entries.length > 0;
  const json = useMemo(() => JSON.stringify(subs, null, 2), [subs]);

  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl">Restricted substances</h2>
          <p className="font-mono text-[11px] text-white/45 mt-1">
            Per-jurisdiction notes. Feeds customs declarations + UKCA / CE marking documentation.
          </p>
        </div>
        {!archived && (
          <button
            type="button"
            onClick={onEditClick}
            className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/35 text-white hover:bg-white/10 transition-colors"
          >
            Edit
          </button>
        )}
      </div>
      {hasEntries ? (
        <>
          <ul className="px-6 py-4 space-y-2">
            {entries.map(([k, v]) => (
              <li
                key={k}
                className="grid gap-3 md:grid-cols-[200px_1fr] items-start font-mono text-[12px]"
              >
                <span className="text-white/55 break-words">{k}</span>
                <span className="text-white/85 break-words whitespace-pre-wrap">
                  {typeof v === 'string' ? v : JSON.stringify(v)}
                </span>
              </li>
            ))}
          </ul>
          <details className="m-6">
            <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-white/65 hover:text-white">
              Raw JSON
            </summary>
            <pre className="mt-3 font-mono text-[11px] text-white/70 overflow-x-auto whitespace-pre">{json}</pre>
          </details>
        </>
      ) : (
        <p className="px-6 py-5 font-mono text-xs text-white/45">
          No restricted-substance notes on file.{' '}
          {!archived && 'Click Edit to add the first jurisdiction. (Required for any goods bearing UKCA / CE marks or shipping to REACH / RoHS jurisdictions.)'}
        </p>
      )}
    </section>
  );
}

type RestrictedSubstancesDraft = {
  rowKey: string;
  key: string;
  value: string;
};

let restrictedSubstancesRowKeyCounter = 0;
function nextRestrictedSubstancesRowKey(): string {
  restrictedSubstancesRowKeyCounter += 1;
  return `restricted-substances-${restrictedSubstancesRowKeyCounter}`;
}

function emptyRestrictedSubstancesDraft(): RestrictedSubstancesDraft {
  return { rowKey: nextRestrictedSubstancesRowKey(), key: '', value: '' };
}

function substancesToDrafts(subs: Record<string, unknown>): RestrictedSubstancesDraft[] {
  const out: RestrictedSubstancesDraft[] = [];
  for (const [k, v] of Object.entries(subs)) {
    out.push({
      rowKey: nextRestrictedSubstancesRowKey(),
      key: k,
      value: typeof v === 'string' ? v : JSON.stringify(v),
    });
  }
  return out;
}

function draftsToSubstances(drafts: RestrictedSubstancesDraft[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of drafts) {
    const k = d.key.trim();
    if (!k) continue;
    out[k] = d.value;
  }
  return out;
}

function substancesEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    const k = aKeys[i];
    const av = a[k];
    const bv = b[k];
    if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
  }
  return true;
}

// Wider key alphabet than EUDR (PR #133) / supplier-metadata (PR #147):
// jurisdiction codes are typically uppercase (UK_REACH, EU_RoHS,
// CA_Prop65). Allow uppercase + lowercase + digits + dots + dashes +
// underscores. Spaces and Unicode still rejected for round-trippability.
const RESTRICTED_SUBSTANCES_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

function RestrictedSubstancesEditorPanel({
  goods,
  initialSubs,
  onCancel,
  onSaved,
}: {
  goods: Goods;
  initialSubs: Record<string, unknown>;
  onCancel: () => void;
  onSaved: (updated: Goods) => void;
}) {
  const [drafts, setDrafts] = useState<RestrictedSubstancesDraft[]>(() => {
    const seeded = substancesToDrafts(initialSubs);
    return seeded.length > 0 ? seeded : [emptyRestrictedSubstancesDraft()];
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function updateRow(rowKey: string, patch: Partial<RestrictedSubstancesDraft>) {
    setDrafts((prev) =>
      prev.map((d) => (d.rowKey === rowKey ? { ...d, ...patch } : d)),
    );
  }

  function removeRow(rowKey: string) {
    setDrafts((prev) => prev.filter((d) => d.rowKey !== rowKey));
  }

  function addRow() {
    setDrafts((prev) => [...prev, emptyRestrictedSubstancesDraft()]);
  }

  function clientSideErrors(): string[] {
    const out: string[] = [];
    const seenKeys = new Map<string, number>();
    drafts.forEach((d, i) => {
      const rowNumber = i + 1;
      const k = d.key.trim();
      const v = d.value;
      if (!k && v.trim()) {
        out.push(`Row ${rowNumber}: jurisdiction is required when a note is present`);
      }
      if (k && !RESTRICTED_SUBSTANCES_KEY_PATTERN.test(k)) {
        out.push(`Row ${rowNumber}: jurisdiction "${k}" must use only letters, digits, dots, dashes, and underscores`);
      }
      if (k) {
        const seenAt = seenKeys.get(k);
        if (seenAt != null) {
          out.push(`Rows ${seenAt} and ${rowNumber} both use jurisdiction "${k}" — jurisdictions must be unique`);
        } else {
          seenKeys.set(k, rowNumber);
        }
      }
    });
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors([]);

    const localErrors = clientSideErrors();
    if (localErrors.length) {
      setErrors(localErrors);
      setSaving(false);
      return;
    }

    const materialised = draftsToSubstances(drafts);

    if (substancesEqual(materialised, initialSubs)) {
      setSaving(false);
      onCancel();
      return;
    }

    try {
      const d = await apiPatch<{ ok: boolean; goods: Goods; unchanged: boolean }>(
        `/goods/${encodeURIComponent(goods.externalId)}`,
        { restrictedSubstances: materialised },
      );
      onSaved(d.goods);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors.length ? err.errors : [err.message]);
      } else if (err instanceof AuthError) {
        setErrors(['Sign in required to save restricted-substance changes.']);
      } else {
        setErrors([err instanceof Error ? err.message : 'Could not save restricted-substance changes.']);
      }
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-10 border border-[var(--color-navy-line)] bg-[var(--color-ink)]"
    >
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)]">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-serif text-xl">Edit restricted substances</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
            {drafts.length} {drafts.length === 1 ? 'jurisdiction' : 'jurisdictions'}
          </span>
        </div>
        <p className="font-mono text-[11px] text-white/45 mt-2">
          Jurisdiction code (e.g. UK_REACH, EU_RoHS, CA_Prop65) → notes / status / cross-reference.
        </p>
      </div>

      <div className="px-6 py-5 space-y-3">
        {drafts.map((d, i) => (
          <RestrictedSubstancesEditRow
            key={d.rowKey}
            index={i}
            draft={d}
            disabled={saving}
            onChange={(patch) => updateRow(d.rowKey, patch)}
            onRemove={() => removeRow(d.rowKey)}
          />
        ))}
        <button
          type="button"
          onClick={addRow}
          disabled={saving}
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/35 text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
        >
          + Add jurisdiction
        </button>
      </div>

      {errors.length > 0 && (
        <ul
          className="border-t border-[var(--color-navy-line)] px-6 py-4 space-y-1"
          role="alert"
        >
          {errors.map((e, i) => (
            <li
              key={i}
              className="font-mono text-[12px]"
              style={{ color: 'var(--color-critical)' }}
            >
              {e}
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-[var(--color-navy-line)] px-6 py-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/30 text-white/85 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 bg-white text-[var(--color-ink)] hover:bg-white/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save restricted substances'}
        </button>
      </div>
    </form>
  );
}

function RestrictedSubstancesEditRow({
  index,
  draft,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  draft: RestrictedSubstancesDraft;
  disabled: boolean;
  onChange: (patch: Partial<RestrictedSubstancesDraft>) => void;
  onRemove: () => void;
}) {
  const rowNumber = index + 1;
  return (
    <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto] items-start">
      <label className="block">
        <span className="sr-only">Jurisdiction code for restricted-substance row {rowNumber}</span>
        <input
          type="text"
          value={draft.key}
          onChange={(e) => onChange({ key: e.target.value })}
          disabled={disabled}
          placeholder="jurisdiction"
          maxLength={120}
          className="block w-full bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-3 py-1.5 font-mono text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/45 disabled:opacity-50"
        />
      </label>
      <label className="block">
        <span className="sr-only">Notes for restricted-substance row {rowNumber}</span>
        <input
          type="text"
          value={draft.value}
          onChange={(e) => onChange({ value: e.target.value })}
          disabled={disabled}
          placeholder="notes / status / cross-reference"
          maxLength={500}
          className="block w-full bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-3 py-1.5 font-mono text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/45 disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove restricted-substance row ${rowNumber}`}
        className="font-mono text-[11px] px-3 py-1.5 border border-white/25 text-white/70 hover:text-white hover:border-white/45 disabled:opacity-50 transition-colors"
      >
        ×
      </button>
    </div>
  );
}
