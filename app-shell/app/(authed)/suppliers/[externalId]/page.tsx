'use client';

// Supplier master detail view. Mirrors /goods/<id> in shape but with
// supplier-specific panels: sanctions, audit certifications (with
// expiry tracking), factory locations, EUDR Due Diligence Statement
// evidence, trust score components.
//
// No state machine — suppliers don't transition like shipments do.
// Lifecycle is create → updates → archive.

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  apiGet,
  apiPatch,
  apiPost,
  AuthError,
  ApiError,
  SUPPLIER_LEGAL_FORMS,
  type AuditCert,
  type Supplier,
  type SupplierSanctionsStatus,
} from '@/lib/api';
import { RelatedShipments } from '@/components/RelatedShipments';
import { TransitionHistory } from '@/components/TransitionHistory';

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IE'); } catch { return d; }
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-IE'); } catch { return d; }
}

function sanctionsTone(s?: SupplierSanctionsStatus | null): string {
  if (s === 'match' || s === 'potential_match') return 'var(--color-critical)';
  if (s === 'clear') return 'var(--color-positive)';
  if (s === 'pending') return 'var(--color-warning)';
  return 'var(--color-ivory-mute)';
}

function sanctionsLabel(s?: SupplierSanctionsStatus | null): string {
  if (!s) return 'Not screened';
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function certExpiryTone(expiresAt?: string): string {
  if (!expiresAt) return 'var(--color-ivory-mute)';
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return 'var(--color-ivory-mute)';
  const days = (t - Date.now()) / (24 * 60 * 60 * 1000);
  if (days < 0) return 'var(--color-critical)';        // expired
  if (days < 90) return 'var(--color-warning)';        // expiring soon
  return 'var(--color-positive)';
}

function certExpiryLabel(expiresAt?: string): string {
  if (!expiresAt) return 'No expiry on file';
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) return expiresAt;
  const days = Math.floor((t - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return `Expired ${fmtDate(expiresAt)}`;
  if (days < 90) return `Expires ${fmtDate(expiresAt)} (${days}d)`;
  return `Valid until ${fmtDate(expiresAt)}`;
}

type LoadState = 'loading' | 'auth' | 'error' | 'notFound' | 'ready';

export default function SupplierDetailPage({ params }: { params: Promise<{ externalId: string }> }) {
  const { externalId } = use(params);
  const [state, setState] = useState<LoadState>('loading');
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  // Edit mode mirrors the goods detail page (PR #122). FactsGrid
  // swaps out for EditForm when editing; sanctions / certs / etc.
  // panels stay in place because they're not part of the inline-
  // editable scalar surface.
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; supplier: Supplier }>(`/suppliers/${encodeURIComponent(externalId)}`)
      .then((d) => { if (!cancelled) { setSupplier(d.supplier); setState('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { setState('auth'); return; }
        const msg = e instanceof Error ? e.message : 'Could not load supplier.';
        if (/404|not found/i.test(msg)) { setState('notFound'); return; }
        setErrorMsg(msg);
        setState('error');
      });
    return () => { cancelled = true; };
  }, [externalId]);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading supplier…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see this supplier</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'notFound') {
    return (
      <div className="max-w-xl">
        <Link href="/suppliers" className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45 hover:text-white">← All suppliers</Link>
        <h1 className="text-4xl mt-3 mb-1">Not found</h1>
        <p className="font-mono text-xs text-white/45">This supplier doesn't exist in your organisation, or it has been archived.</p>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">{errorMsg}</p>;
  if (!supplier) return null;

  return (
    <div className="max-w-4xl">
      <Header
        supplier={supplier}
        editing={editing}
        onEdit={() => setEditing(true)}
      />
      {editing ? (
        <EditForm
          supplier={supplier}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            setSupplier(updated);
            setEditing(false);
          }}
        />
      ) : (
        <FactsGrid supplier={supplier} />
      )}
      <SanctionsPanel
        supplier={supplier}
        onRescreened={(updated) => setSupplier(updated)}
      />
      {/* PR #130: Panel always renders so operators can ADD an audit
          cert to a supplier that doesn't yet have any. Same pattern
          as PR #129's SVHC editor — the empty-state check moved
          inside the panel. */}
      <AuditCertsPanel
        supplier={supplier}
        onSaved={(updated) => setSupplier(updated)}
      />
      {supplier.factoryLocations && supplier.factoryLocations.length > 0 && (
        <FactoryLocationsPanel supplier={supplier} />
      )}
      {supplier.eudrDdsEvidence && Object.keys(supplier.eudrDdsEvidence).length > 0 && (
        <EudrPanel supplier={supplier} />
      )}
      {supplier.trustScoreComponents && Object.keys(supplier.trustScoreComponents).length > 0 && (
        <TrustComponentsPanel supplier={supplier} />
      )}
      <RelatedShipments filter={{ kind: 'supplier', externalId: supplier.externalId }} />
      <TransitionHistory externalId={supplier.externalId} entityKind="supplier" />
    </div>
  );
}

function Header({
  supplier,
  editing,
  onEdit,
}: {
  supplier: Supplier;
  editing: boolean;
  onEdit: () => void;
}) {
  return (
    <header className="mb-8">
      <Link href="/suppliers" className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45 hover:text-white">
        ← All suppliers
      </Link>
      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-4xl text-white">{supplier.entityName}</h1>
          <p className="font-mono text-[12px] text-white/55 mt-2">
            HQ {supplier.hqCountry}
            {supplier.legalForm && ` · ${supplier.legalForm.toUpperCase()}`}
            {' · '}{supplier.externalId}
          </p>
        </div>
        <div className="flex items-start gap-3">
          <span
            className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border"
            style={{
              borderColor: sanctionsTone(supplier.sanctionsLastStatus),
              color: sanctionsTone(supplier.sanctionsLastStatus),
            }}
          >
            {sanctionsLabel(supplier.sanctionsLastStatus)}
          </span>
          {!editing && !supplier.archivedAt && (
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

// EditForm — inline edit mode for the scalar identifying fields of a
// supplier master record. Mirrors the goods edit form pattern from
// PR #122: sparse patch, no-op short-circuit, inline server-error
// rendering, client-side validation matching lib/db/suppliers.js
// validateForUpdate.
//
// Editable: entityName, legalForm, hqCountry, registrationNumber,
//           registrationAuthority, website.
// NOT editable here (each has its own flow or is calculator-grounded):
//   sanctionsLastStatus + sanctionsLastScreenedAt + sanctionsLastMatchSummary
//     → re-screen action (separate operator flow)
//   trustScore + trustScoreComponents + trustScoreComputedAt
//     → calculator-grounded per ADR 0002, never hand-edited
//   factoryLocations / auditCerts / eudrDdsEvidence / metadata
//     → jsonb fields, need structured editors (deferred, same as goods)
//   primaryContactEmailHash → PII, separate add-contact flow.
function EditForm({
  supplier,
  onCancel,
  onSaved,
}: {
  supplier: Supplier;
  onCancel: () => void;
  onSaved: (updated: Supplier) => void;
}) {
  const [entityName, setEntityName] = useState(supplier.entityName);
  const [legalForm, setLegalForm] = useState(supplier.legalForm || '');
  const [hqCountry, setHqCountry] = useState(supplier.hqCountry);
  const [registrationNumber, setRegistrationNumber] = useState(supplier.registrationNumber || '');
  const [registrationAuthority, setRegistrationAuthority] = useState(supplier.registrationAuthority || '');
  const [website, setWebsite] = useState(supplier.website || '');

  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function clientSideErrors(): string[] {
    const out: string[] = [];
    if (!entityName.trim()) out.push('entityName must be a non-empty string');
    else if (entityName.length > 200) out.push('entityName must be ≤200 chars');
    if (!/^[A-Z]{2}$/.test(hqCountry.trim().toUpperCase())) {
      out.push('hqCountry must be ISO-2 uppercase');
    }
    if (legalForm && !SUPPLIER_LEGAL_FORMS.includes(legalForm)) {
      out.push(`legalForm must be one of: ${SUPPLIER_LEGAL_FORMS.join(', ')}`);
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

    // Sparse patch — only send changed fields. Trim text inputs to
    // collapse whitespace-only edits (which validateForUpdate would
    // reject for required fields anyway).
    const patch: Record<string, unknown> = {};
    const entityTrim = entityName.trim();
    if (entityTrim !== supplier.entityName) patch.entityName = entityTrim;
    // legalForm: '' means "clear it" → null on the server.
    const lfCurrent = supplier.legalForm || '';
    if (legalForm !== lfCurrent) patch.legalForm = legalForm || null;
    const hqNorm = hqCountry.trim().toUpperCase();
    if (hqNorm !== supplier.hqCountry) patch.hqCountry = hqNorm;
    const regCurrent = supplier.registrationNumber || '';
    if (registrationNumber.trim() !== regCurrent) {
      patch.registrationNumber = registrationNumber.trim() || null;
    }
    const authCurrent = supplier.registrationAuthority || '';
    if (registrationAuthority.trim() !== authCurrent) {
      patch.registrationAuthority = registrationAuthority.trim() || null;
    }
    const webCurrent = supplier.website || '';
    if (website.trim() !== webCurrent) {
      patch.website = website.trim() || null;
    }

    if (Object.keys(patch).length === 0) {
      // No-change short-circuit — mirrors lib/db/suppliers.js's own
      // setClauses-empty path. Save a round-trip + an audit-noise
      // event.
      setSaving(false);
      onCancel();
      return;
    }

    try {
      const d = await apiPatch<{ ok: boolean; supplier: Supplier; unchanged: boolean }>(
        `/suppliers/${encodeURIComponent(supplier.externalId)}`,
        patch,
      );
      onSaved(d.supplier);
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
        <h2 className="font-serif text-xl">Edit supplier record</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
          {supplier.externalId} · sanctions/trust read-only
        </span>
      </div>

      <div className="px-6 py-6 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
        <EditField
          label="Entity name"
          value={entityName}
          onChange={setEntityName}
          required
          maxLength={200}
        />
        <EditSelectField
          label="Legal form"
          value={legalForm}
          onChange={setLegalForm}
          options={SUPPLIER_LEGAL_FORMS}
          hint="Blank = unspecified."
        />
        <EditField
          label="HQ country"
          value={hqCountry}
          onChange={(v) => setHqCountry(v.toUpperCase())}
          required
          hint="ISO-2 (e.g. CN, DE)."
          maxLength={2}
        />
        <EditField
          label="Registration number"
          value={registrationNumber}
          onChange={setRegistrationNumber}
          hint="Blank = unspecified. Must be unique within your org."
          maxLength={100}
        />
        <EditField
          label="Registration authority"
          value={registrationAuthority}
          onChange={setRegistrationAuthority}
          hint="e.g. Companies House, KRS, Handelsregister."
          maxLength={120}
        />
        <EditField
          label="Website"
          value={website}
          onChange={setWebsite}
          hint="Full URL with scheme."
          maxLength={300}
        />
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

// Reusable text input for the edit form. Named EditField (not Field)
// because the surrounding FactsGrid already has a local Field helper
// for read-only display. Kept local — exporting to a shared module
// would require a styling-API negotiation that isn't worth the
// abstraction gain at this call count.
function EditField({
  label,
  value,
  onChange,
  required,
  maxLength,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  maxLength?: number;
  hint?: string;
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
        className="mt-1.5 block w-full bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-3 py-2 font-mono text-[13px] text-white focus:outline-none focus:border-white/55"
      />
      {hint && (
        <span className="block mt-1 font-mono text-[10px] text-white/40">{hint}</span>
      )}
    </label>
  );
}

// Closed-taxonomy <select> with a blank "—" option. Used for
// legalForm only at this point; if a second enum needs the same
// pattern (e.g. supplier sanctions-status if ever surfaced), extract
// to a shared component instead of duplicating.
function EditSelectField({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<string>;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 block w-full bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-3 py-2 font-mono text-[13px] text-white focus:outline-none focus:border-white/55"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.toUpperCase()}
          </option>
        ))}
      </select>
      {hint && (
        <span className="block mt-1 font-mono text-[10px] text-white/40">{hint}</span>
      )}
    </label>
  );
}

function FactsGrid({ supplier }: { supplier: Supplier }) {
  const facts = [
    { label: 'HQ country', value: supplier.hqCountry },
    { label: 'Legal form', value: supplier.legalForm ?? '—' },
    { label: 'Registration #', value: supplier.registrationNumber ?? '—' },
    { label: 'Registration authority', value: supplier.registrationAuthority ?? '—' },
    { label: 'Website', value: supplier.website ?? '—' },
    { label: 'Last on-site audit', value: fmtDate(supplier.lastOnSiteAuditDate) },
    { label: 'Trust score', value: supplier.trustScore != null ? `${supplier.trustScore} / 100` : '—' },
    { label: 'Trust computed', value: fmtDateTime(supplier.trustScoreComputedAt) },
    { label: 'Created', value: fmtDate(supplier.createdAt) },
    { label: 'Updated', value: fmtDate(supplier.updatedAt) },
    { label: 'Archived', value: supplier.archivedAt ? fmtDate(supplier.archivedAt) : '—' },
  ];
  return (
    <section className="mb-10 grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-navy-line)] border border-[var(--color-navy-line)]">
      {facts.map((f) => (
        <div key={f.label} className="bg-[var(--color-ink)] px-4 py-4">
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{f.label}</div>
          <div className="font-mono text-[13px] text-white mt-1.5 break-words">{f.value}</div>
        </div>
      ))}
    </section>
  );
}

function SanctionsPanel({
  supplier,
  onRescreened,
}: {
  supplier: Supplier;
  onRescreened: (updated: Supplier) => void;
}) {
  const status = supplier.sanctionsLastStatus;
  const flagged = status === 'match' || status === 'potential_match';
  const archived = Boolean(supplier.archivedAt);

  // Self-contained re-screen state. Lifting this to the page would
  // be possible but would couple unrelated UI sections (the edit
  // form, the timeline, etc.) to screening operations. Keeping it
  // local makes the SanctionsPanel a self-contained operator
  // affordance.
  const [rescreening, setRescreening] = useState(false);
  const [rescreenError, setRescreenError] = useState<string>('');

  async function runRescreen() {
    if (rescreening) return;
    setRescreening(true);
    setRescreenError('');
    try {
      // POST with empty body — the supplier's identity is the URL;
      // the server reads entityName from the persisted row, not the
      // request. (Letting the client send a name would create a
      // forge-the-screen-target vulnerability.)
      const d = await apiPost<{ ok: boolean; supplier: Supplier }>(
        `/suppliers/${encodeURIComponent(supplier.externalId)}/screen`,
        {},
      );
      onRescreened(d.supplier);
    } catch (err) {
      if (err instanceof ApiError) {
        setRescreenError(err.errors[0] || err.message);
      } else if (err instanceof AuthError) {
        setRescreenError('Sign in required to re-screen.');
      } else {
        setRescreenError(err instanceof Error ? err.message : 'Could not re-screen.');
      }
    } finally {
      setRescreening(false);
    }
  }

  return (
    <section
      className="mb-10 border"
      style={{ borderColor: flagged ? 'var(--color-critical)' : 'var(--color-navy-line)' }}
    >
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between gap-3">
        <h2
          className="font-serif text-xl"
          style={{ color: flagged ? 'var(--color-critical)' : 'var(--color-ivory)' }}
        >
          Sanctions screening
        </h2>
        <div className="flex items-center gap-3">
          <span
            className="font-mono text-[11px] uppercase tracking-[0.12em]"
            style={{ color: sanctionsTone(status) }}
          >
            {sanctionsLabel(status)}
          </span>
          {!archived && (
            <button
              type="button"
              onClick={runRescreen}
              disabled={rescreening}
              className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border border-white/35 text-white hover:bg-white/10 disabled:opacity-50 transition-colors"
            >
              {rescreening ? 'Re-screening…' : 'Re-screen'}
            </button>
          )}
        </div>
      </div>
      <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-6">
        <Field label="Last screened" value={fmtDateTime(supplier.sanctionsLastScreenedAt)} />
        {flagged && supplier.sanctionsLastMatchSummary && Object.keys(supplier.sanctionsLastMatchSummary).length > 0 && (
          <details className="md:col-span-2">
            <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-white/65 hover:text-white">
              Match summary
            </summary>
            <pre className="mt-3 font-mono text-[11px] text-white/70 overflow-x-auto whitespace-pre">
              {JSON.stringify(supplier.sanctionsLastMatchSummary, null, 2)}
            </pre>
          </details>
        )}
        {rescreenError && (
          <p
            role="alert"
            className="md:col-span-2 font-mono text-[12px]"
            style={{ color: 'var(--color-critical)' }}
          >
            {rescreenError}
          </p>
        )}
      </div>
    </section>
  );
}

// AuditCertsPanel — read view of declared audit certifications +
// per-row editor (PR #130). Mirrors the ReachSvhcPanel pattern from
// PR #129: read mode + edit mode toggle, stable rowKey, sparse-
// flag materialisation, order-insensitive equality, sparse PATCH
// body.
//
// Why a dedicated editor (not part of EditForm from PR #123):
// supplier audit certs are an ARRAY-of-objects jsonb field — same
// argument as SVHC. EditForm handles scalar identifying fields;
// this editor handles the certification list with per-row inputs
// for standard / issuer / cert number / issued / expires / evidence
// URL.
//
// Validation mirrors lib/db/suppliers.js validateForUpdate's
// auditCerts shape (must be an array — already enforced at the
// type boundary). Per-row constraints layered on top here:
//   - standard required (the certification body's name — the row
//     can't audit without identifying what it certifies)
//   - issuedAt + expiresAt (if both present): expires > issued
//   - evidenceUrl (if present): well-formed URL
function AuditCertsPanel({
  supplier,
  onSaved,
}: {
  supplier: Supplier;
  onSaved: (updated: Supplier) => void;
}) {
  const persistedCerts = supplier.auditCerts || [];
  const archived = Boolean(supplier.archivedAt);
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <AuditCertsReadPanel
        certs={persistedCerts}
        archived={archived}
        onEditClick={() => setEditing(true)}
      />
    );
  }

  return (
    <AuditCertsEditorPanel
      supplier={supplier}
      initialCerts={persistedCerts}
      onCancel={() => setEditing(false)}
      onSaved={(updated) => {
        onSaved(updated);
        setEditing(false);
      }}
    />
  );
}

function AuditCertsReadPanel({
  certs,
  archived,
  onEditClick,
}: {
  certs: AuditCert[];
  archived: boolean;
  onEditClick: () => void;
}) {
  const hasCerts = certs.length > 0;
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between gap-3">
        <h2 className="font-serif text-xl">Audit certifications</h2>
        <div className="flex items-center gap-3">
          {hasCerts && (
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
              {certs.length} on file
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
      {hasCerts ? (
        <ul>
          {certs.map((c, i) => (
            <li
              key={c.certNumber || `${c.standard}-${i}`}
              className="px-6 py-4 border-t border-[var(--color-navy-line)] flex items-center justify-between gap-6"
            >
              <div>
                <div className="font-serif text-[14px] text-white">
                  {(c.standard || 'Unnamed').toUpperCase()}
                </div>
                <div className="font-mono text-[11px] text-white/55 mt-1">
                  {c.issuer && `Issued by ${c.issuer}`}
                  {c.certNumber && ` · #${c.certNumber}`}
                  {c.issuedAt && ` · issued ${fmtDate(c.issuedAt)}`}
                </div>
              </div>
              <span
                className="font-mono text-[11px] uppercase tracking-[0.12em] px-2 py-1 border"
                style={{
                  borderColor: certExpiryTone(c.expiresAt),
                  color: certExpiryTone(c.expiresAt),
                }}
              >
                {certExpiryLabel(c.expiresAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-6 py-5 font-mono text-xs text-white/45">
          No audit certifications on file yet.{' '}
          {!archived && 'Click Edit to add the first entry.'}
        </p>
      )}
    </section>
  );
}

// Working type for the editor — looser than AuditCert so date
// strings stay raw input. Carries a stable rowKey so React
// reconciliation survives reorders + add/remove without losing
// focus.
type AuditCertDraft = {
  rowKey: string;
  standard: string;
  issuer: string;
  certNumber: string;
  issuedAt: string;
  expiresAt: string;
  evidenceUrl: string;
};

let auditCertRowKeyCounter = 0;
function nextAuditCertRowKey(): string {
  auditCertRowKeyCounter += 1;
  return `auditcert-${auditCertRowKeyCounter}`;
}

function emptyAuditCertDraft(): AuditCertDraft {
  return {
    rowKey: nextAuditCertRowKey(),
    standard: '',
    issuer: '',
    certNumber: '',
    issuedAt: '',
    expiresAt: '',
    evidenceUrl: '',
  };
}

function auditCertToDraft(c: AuditCert): AuditCertDraft {
  return {
    rowKey: nextAuditCertRowKey(),
    standard: typeof c.standard === 'string' ? c.standard : '',
    issuer: typeof c.issuer === 'string' ? c.issuer : '',
    certNumber: typeof c.certNumber === 'string' ? c.certNumber : '',
    issuedAt: typeof c.issuedAt === 'string' ? c.issuedAt : '',
    expiresAt: typeof c.expiresAt === 'string' ? c.expiresAt : '',
    evidenceUrl: typeof c.evidenceUrl === 'string' ? c.evidenceUrl : '',
  };
}

function draftToAuditCert(d: AuditCertDraft): AuditCert | null {
  // Drop completely-empty rows. Same semantics as PR #129's SVHC
  // editor — "operator added a row and then cancelled out of it"
  // is treated as a no-op rather than a validation error.
  const standard = d.standard.trim();
  const issuer = d.issuer.trim();
  const certNumber = d.certNumber.trim();
  const issuedAt = d.issuedAt.trim();
  const expiresAt = d.expiresAt.trim();
  const evidenceUrl = d.evidenceUrl.trim();
  if (!standard && !issuer && !certNumber && !issuedAt && !expiresAt && !evidenceUrl) {
    return null;
  }
  const out: AuditCert = {};
  if (standard) out.standard = standard;
  if (issuer) out.issuer = issuer;
  if (certNumber) out.certNumber = certNumber;
  if (issuedAt) out.issuedAt = issuedAt;
  if (expiresAt) out.expiresAt = expiresAt;
  if (evidenceUrl) out.evidenceUrl = evidenceUrl;
  return out;
}

// Order-insensitive equality — same logic as PR #129's flagsEqual.
// Re-order-then-undo cycles exit without writing a noise audit
// event.
function auditCertsEqual(a: AuditCert[], b: AuditCert[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (c: AuditCert) =>
    [
      c.standard ?? '',
      c.issuer ?? '',
      c.certNumber ?? '',
      c.issuedAt ?? '',
      c.expiresAt ?? '',
      c.evidenceUrl ?? '',
    ].join('|');
  const aSet = a.map(norm).sort();
  const bSet = b.map(norm).sort();
  return aSet.every((v, i) => v === bSet[i]);
}

function isPlausibleDateInput(s: string): boolean {
  // Accept YYYY-MM-DD (HTML date input native format) OR a value
  // Date.parse can interpret. Keeps the bar low — date validity is
  // re-checked server-side; we just want to catch obvious garbage
  // before the PATCH fires.
  if (!s) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

function AuditCertsEditorPanel({
  supplier,
  initialCerts,
  onCancel,
  onSaved,
}: {
  supplier: Supplier;
  initialCerts: AuditCert[];
  onCancel: () => void;
  onSaved: (updated: Supplier) => void;
}) {
  const [drafts, setDrafts] = useState<AuditCertDraft[]>(() =>
    initialCerts.length > 0
      ? initialCerts.map(auditCertToDraft)
      : [emptyAuditCertDraft()],
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  function updateRow(rowKey: string, patch: Partial<AuditCertDraft>) {
    setDrafts((prev) =>
      prev.map((d) => (d.rowKey === rowKey ? { ...d, ...patch } : d)),
    );
  }

  function removeRow(rowKey: string) {
    setDrafts((prev) => prev.filter((d) => d.rowKey !== rowKey));
  }

  function addRow() {
    setDrafts((prev) => [...prev, emptyAuditCertDraft()]);
  }

  function clientSideErrors(materialised: AuditCert[]): string[] {
    const out: string[] = [];
    materialised.forEach((c, i) => {
      const rowNumber = i + 1;
      // The standard is the certification body's name — without
      // it the row carries no audit value. Drop "row carries only
      // a cert number with no standard" rather than silently
      // accepting an un-auditable entry.
      if (!c.standard) {
        out.push(`Row ${rowNumber}: standard is required`);
      }
      // Date plausibility (skipping when absent — both dates are
      // optional, but if you say a cert was issued, the date must
      // be a date).
      if (c.issuedAt && !isPlausibleDateInput(String(c.issuedAt))) {
        out.push(`Row ${rowNumber}: issued date is not a valid date`);
      }
      if (c.expiresAt && !isPlausibleDateInput(String(c.expiresAt))) {
        out.push(`Row ${rowNumber}: expiry date is not a valid date`);
      }
      // Temporal sanity: expiry must be after issuance (zero-day
      // certs aren't a thing). Comparison runs on Date.parse'd
      // milliseconds; the HTML5 date input already gives
      // YYYY-MM-DD which parses cleanly.
      if (c.issuedAt && c.expiresAt) {
        const issued = Date.parse(String(c.issuedAt));
        const expires = Date.parse(String(c.expiresAt));
        if (Number.isFinite(issued) && Number.isFinite(expires) && expires <= issued) {
          out.push(`Row ${rowNumber}: expiry date must be after the issued date`);
        }
      }
      // Light URL sanity — must include a scheme so accidental
      // "www.bsci…" pastes get flagged. Server may re-validate.
      if (c.evidenceUrl) {
        try {
          new URL(String(c.evidenceUrl));
        } catch (_) {
          out.push(`Row ${rowNumber}: evidence URL must include a scheme (https://…)`);
        }
      }
    });
    return out;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors([]);

    const materialised = drafts
      .map(draftToAuditCert)
      .filter((c): c is AuditCert => c !== null);

    const localErrors = clientSideErrors(materialised);
    if (localErrors.length) {
      setErrors(localErrors);
      setSaving(false);
      return;
    }

    if (auditCertsEqual(materialised, initialCerts)) {
      setSaving(false);
      onCancel();
      return;
    }

    try {
      const d = await apiPatch<{ ok: boolean; supplier: Supplier; unchanged: boolean }>(
        `/suppliers/${encodeURIComponent(supplier.externalId)}`,
        { auditCerts: materialised },
      );
      onSaved(d.supplier);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors.length ? err.errors : [err.message]);
      } else if (err instanceof AuthError) {
        setErrors(['Sign in required to save audit cert changes.']);
      } else {
        setErrors([err instanceof Error ? err.message : 'Could not save audit cert changes.']);
      }
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-10 border border-[var(--color-navy-line)] bg-[var(--color-ink)]"
    >
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl">Edit audit certifications</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
          {drafts.length} {drafts.length === 1 ? 'row' : 'rows'}
        </span>
      </div>

      <div className="px-6 py-5 space-y-4">
        {drafts.map((d, i) => (
          <AuditCertEditRow
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
          + Add certification
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
          {saving ? 'Saving…' : 'Save certifications'}
        </button>
      </div>
    </form>
  );
}

function AuditCertEditRow({
  index,
  draft,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  draft: AuditCertDraft;
  disabled: boolean;
  onChange: (patch: Partial<AuditCertDraft>) => void;
  onRemove: () => void;
}) {
  const rowNumber = index + 1;
  return (
    <div className="border border-[var(--color-navy-line)] px-3 py-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
          Certification {rowNumber}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove certification row ${rowNumber}`}
          className="font-mono text-[11px] px-3 py-1 border border-white/25 text-white/70 hover:text-white hover:border-white/45 disabled:opacity-50 transition-colors"
        >
          ×
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <AuditCertField
          label="Standard"
          required
          value={draft.standard}
          onChange={(v) => onChange({ standard: v })}
          disabled={disabled}
          placeholder="e.g. BSCI, SA8000, ISO 9001"
          maxLength={64}
        />
        <AuditCertField
          label="Issuer"
          value={draft.issuer}
          onChange={(v) => onChange({ issuer: v })}
          disabled={disabled}
          placeholder="e.g. amfori, SGS, Bureau Veritas"
          maxLength={120}
        />
        <AuditCertField
          label="Cert number"
          value={draft.certNumber}
          onChange={(v) => onChange({ certNumber: v })}
          disabled={disabled}
          placeholder="Reference number"
          maxLength={64}
        />
        <AuditCertField
          label="Evidence URL"
          value={draft.evidenceUrl}
          onChange={(v) => onChange({ evidenceUrl: v })}
          disabled={disabled}
          placeholder="https://…"
          maxLength={300}
        />
        <AuditCertField
          label="Issued"
          type="date"
          value={draft.issuedAt}
          onChange={(v) => onChange({ issuedAt: v })}
          disabled={disabled}
        />
        <AuditCertField
          label="Expires"
          type="date"
          value={draft.expiresAt}
          onChange={(v) => onChange({ expiresAt: v })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function AuditCertField({
  label,
  value,
  onChange,
  disabled,
  required,
  placeholder,
  maxLength,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  type?: 'text' | 'date';
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
        {label}
        {required && <span className="ml-1 text-white/60">*</span>}
      </span>
      <input
        type={type || 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        required={required}
        className="mt-1.5 block w-full bg-[var(--color-ink)] border border-[var(--color-navy-line)] px-3 py-1.5 font-mono text-[12px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/45 disabled:opacity-50"
      />
    </label>
  );
}

function FactoryLocationsPanel({ supplier }: { supplier: Supplier }) {
  const locs = supplier.factoryLocations || [];
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl">Factory locations</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
          {locs.length} site{locs.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul>
        {locs.map((l, i) => (
          <li key={`${l.countryCode}-${l.city}-${i}`} className="px-6 py-4 border-t border-[var(--color-navy-line)] flex items-center justify-between gap-6">
            <div>
              <div className="font-serif text-[14px] text-white">
                {l.city || '—'}{l.countryCode ? `, ${l.countryCode}` : ''}
              </div>
              <div className="font-mono text-[11px] text-white/55 mt-1">
                {l.role || '—'}
                {l.floorAreaSqm != null && ` · ${l.floorAreaSqm.toLocaleString('en-IE')} m²`}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EudrPanel({ supplier }: { supplier: Supplier }) {
  const json = useMemo(
    () => JSON.stringify(supplier.eudrDdsEvidence || {}, null, 2),
    [supplier.eudrDdsEvidence],
  );
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)]">
        <h2 className="font-serif text-xl">EUDR Due Diligence Statement evidence</h2>
        <p className="font-mono text-[11px] text-white/45 mt-1">
          Evidence trail for EU Deforestation Regulation Article 8 compliance.
        </p>
      </div>
      <details className="m-6">
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-white/65 hover:text-white">
          eudrDdsEvidence
        </summary>
        <pre className="mt-3 font-mono text-[11px] text-white/70 overflow-x-auto whitespace-pre">{json}</pre>
      </details>
    </section>
  );
}

function TrustComponentsPanel({ supplier }: { supplier: Supplier }) {
  const components = supplier.trustScoreComponents || {};
  const entries = Object.entries(components);
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)]">
        <h2 className="font-serif text-xl">Trust score components</h2>
        <p className="font-mono text-[11px] text-white/45 mt-1">
          Per-component breakdown so the {supplier.trustScore ?? '—'}-point score is auditable.
        </p>
      </div>
      <div className="px-6 py-5 grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-6">
        {entries.map(([k, v]) => (
          <Field key={k} label={k} value={typeof v === 'number' ? String(v) : JSON.stringify(v)} mono />
        ))}
      </div>
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{label}</div>
      <div className={`mt-1 ${mono ? 'font-mono text-[12px]' : 'text-[14px]'} text-white break-words`}>{value}</div>
    </div>
  );
}
