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
      {goods.reachSvhcFlags && goods.reachSvhcFlags.length > 0 && (
        <ReachSvhcPanel goods={goods} />
      )}
      {goods.restrictedSubstances && Object.keys(goods.restrictedSubstances).length > 0 && (
        <RestrictedSubstancesPanel goods={goods} />
      )}
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
// cbamInScope). Complex jsonb fields (reachSvhcFlags,
// restrictedSubstances, metadata) are intentionally NOT editable here
// — they need structured editors that aren't worth the surface area
// in this PR; the data layer accepts them via PATCH already, so a
// follow-up can add them without touching this form.
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

function ReachSvhcPanel({ goods }: { goods: Goods }) {
  const flags = goods.reachSvhcFlags || [];
  return (
    <section className="mb-10 border" style={{ borderColor: 'var(--color-warning)' }}>
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl" style={{ color: 'var(--color-warning)' }}>REACH SVHC flags</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-warning)' }}>
          {flags.length} declared
        </span>
      </div>
      <ul>
        {flags.map((f, i) => (
          <li key={f.cas || `flag-${i}`} className="px-6 py-3 border-t border-[var(--color-navy-line)] flex items-center justify-between gap-6">
            <div>
              <div className="font-serif text-[14px] text-white">{f.name || f.cas || 'Unnamed SVHC'}</div>
              <div className="font-mono text-[11px] text-white/55 mt-1">
                {f.cas ? `CAS ${f.cas}` : ''}
                {f.threshold_pct != null ? ` · threshold ${f.threshold_pct}%` : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RestrictedSubstancesPanel({ goods }: { goods: Goods }) {
  const subs = goods.restrictedSubstances || {};
  const json = useMemo(() => JSON.stringify(subs, null, 2), [subs]);
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)]">
        <h2 className="font-serif text-xl">Restricted substances</h2>
        <p className="font-mono text-[11px] text-white/45 mt-1">
          Per-jurisdiction notes captured at goods-master creation.
        </p>
      </div>
      <details className="m-6">
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-white/65 hover:text-white">
          restrictedSubstances
        </summary>
        <pre className="mt-3 font-mono text-[11px] text-white/70 overflow-x-auto whitespace-pre">{json}</pre>
      </details>
    </section>
  );
}
