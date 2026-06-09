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
  AuthError,
  type Supplier,
  type SupplierSanctionsStatus,
} from '@/lib/api';

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
      <Header supplier={supplier} />
      <FactsGrid supplier={supplier} />
      <SanctionsPanel supplier={supplier} />
      {supplier.auditCerts && supplier.auditCerts.length > 0 && (
        <AuditCertsPanel supplier={supplier} />
      )}
      {supplier.factoryLocations && supplier.factoryLocations.length > 0 && (
        <FactoryLocationsPanel supplier={supplier} />
      )}
      {supplier.eudrDdsEvidence && Object.keys(supplier.eudrDdsEvidence).length > 0 && (
        <EudrPanel supplier={supplier} />
      )}
      {supplier.trustScoreComponents && Object.keys(supplier.trustScoreComponents).length > 0 && (
        <TrustComponentsPanel supplier={supplier} />
      )}
    </div>
  );
}

function Header({ supplier }: { supplier: Supplier }) {
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
        <span
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border"
          style={{
            borderColor: sanctionsTone(supplier.sanctionsLastStatus),
            color: sanctionsTone(supplier.sanctionsLastStatus),
          }}
        >
          {sanctionsLabel(supplier.sanctionsLastStatus)}
        </span>
      </div>
    </header>
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

function SanctionsPanel({ supplier }: { supplier: Supplier }) {
  const status = supplier.sanctionsLastStatus;
  const flagged = status === 'match' || status === 'potential_match';
  return (
    <section
      className="mb-10 border"
      style={{ borderColor: flagged ? 'var(--color-critical)' : 'var(--color-navy-line)' }}
    >
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2
          className="font-serif text-xl"
          style={{ color: flagged ? 'var(--color-critical)' : 'var(--color-ivory)' }}
        >
          Sanctions screening
        </h2>
        <span
          className="font-mono text-[11px] uppercase tracking-[0.12em]"
          style={{ color: sanctionsTone(status) }}
        >
          {sanctionsLabel(status)}
        </span>
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
      </div>
    </section>
  );
}

function AuditCertsPanel({ supplier }: { supplier: Supplier }) {
  const certs = supplier.auditCerts || [];
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl">Audit certifications</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/60">
          {certs.length} on file
        </span>
      </div>
      <ul>
        {certs.map((c, i) => (
          <li key={c.certNumber || `${c.standard}-${i}`} className="px-6 py-4 border-t border-[var(--color-navy-line)] flex items-center justify-between gap-6">
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
    </section>
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
