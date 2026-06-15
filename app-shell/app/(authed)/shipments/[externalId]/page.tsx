'use client';

// Shipment detail — the operational record's per-shipment view.
// Renders the seven sections an ops team needs to work a shipment:
//   1. Header (status + label + route + back link)
//   2. Quick facts grid (customs value, weight, planned/actual dates)
//   3. State-machine controls (legal next-state buttons; illegal
//      transitions never render → no 409 surprises)
//   4. Exception state (only when status === 'exception')
//   5. Reference links (goods + supplier master records)
//   6. Document vault (read-only list; vault-management is a follow-up)
//   7. Reproducibility snapshots (collapsible inputs + quote JSON for
//      audit / reproduce)

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  apiGet,
  apiPost,
  AuthError,
  SHIPMENT_VALID_TRANSITIONS,
  type Shipment,
  type ShipmentStatus,
} from '@/lib/api';
import { TransitionHistory } from '@/components/TransitionHistory';

function eurFromCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return '€' + Math.round(cents / 100).toLocaleString('en-IE');
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-IE'); } catch { return d; }
}

function fmtDateTime(d?: string | null) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('en-IE'); } catch { return d; }
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

type LoadState = 'loading' | 'auth' | 'error' | 'notFound' | 'ready';

export default function ShipmentDetailPage({ params }: { params: Promise<{ externalId: string }> }) {
  // Next 15 Server-then-Client async params unwrapping.
  const { externalId } = use(params);
  const [state, setState] = useState<LoadState>('loading');
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    apiGet<{ ok: boolean; shipment: Shipment }>(`/shipments/${encodeURIComponent(externalId)}`)
      .then((d) => { if (!cancelled) { setShipment(d.shipment); setState('ready'); } })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof AuthError) { setState('auth'); return; }
        const msg = e instanceof Error ? e.message : 'Could not load shipment.';
        if (/404|not found/i.test(msg)) { setState('notFound'); return; }
        setErrorMsg(msg);
        setState('error');
      });
    return () => { cancelled = true; };
  }, [externalId]);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading shipment…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see this shipment</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'notFound') {
    return (
      <div className="max-w-xl">
        <Link href="/shipments" className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45 hover:text-white">← All shipments</Link>
        <h1 className="text-4xl mt-3 mb-1">Not found</h1>
        <p className="font-mono text-xs text-white/45">This shipment doesn't exist in your organisation, or it has been archived.</p>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">{errorMsg}</p>;
  if (!shipment) return null;

  return (
    <div className="max-w-4xl">
      <Header shipment={shipment} />
      <FactsGrid shipment={shipment} />
      <TransitionControls
        shipment={shipment}
        onTransitioned={(updated) => setShipment(updated)}
      />
      {shipment.status === 'exception' && (
        <ExceptionPanel shipment={shipment} />
      )}
      <ReferencesPanel shipment={shipment} />
      <DocumentVaultPanel shipment={shipment} />
      <SnapshotsPanel shipment={shipment} />
      <TransitionHistory externalId={shipment.externalId} />
    </div>
  );
}

function Header({ shipment }: { shipment: Shipment }) {
  const o = shipment.originCountry || '?';
  const d = shipment.destinationCountry || '?';
  return (
    <header className="mb-8">
      <Link href="/shipments" className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/45 hover:text-white">
        ← All shipments
      </Link>
      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <h1 className="text-4xl text-white">{shipment.label}</h1>
          <p className="font-mono text-[12px] text-white/55 mt-2">
            {o} → {d} · {shipment.externalId}
          </p>
        </div>
        <span
          className="font-mono text-[11px] uppercase tracking-[0.12em] px-3 py-1.5 border"
          style={{ borderColor: statusTone(shipment.status), color: statusTone(shipment.status) }}
        >
          {statusLabel(shipment.status)}
        </span>
      </div>
    </header>
  );
}

function FactsGrid({ shipment }: { shipment: Shipment }) {
  const facts = [
    { label: 'Customs value', value: eurFromCents(shipment.customsValueCents) },
    { label: 'Weight', value: shipment.weightKg != null ? `${shipment.weightKg.toLocaleString('en-IE')} kg` : '—' },
    { label: 'Containers', value: shipment.containerCount?.toString() ?? '—' },
    { label: 'Carrier', value: shipment.carrier ?? '—' },
    { label: 'Planned departure', value: fmtDate(shipment.plannedDepartureDate) },
    { label: 'Planned arrival', value: fmtDate(shipment.plannedArrivalDate) },
    { label: 'Actual departure', value: fmtDate(shipment.actualDepartureDate) },
    { label: 'ETA', value: fmtDate(shipment.eta) },
    { label: 'BL number', value: shipment.blNumber ?? '—' },
    { label: 'Booking ref', value: shipment.bookingRef ?? '—' },
    { label: 'Cleared at', value: fmtDateTime(shipment.clearedAt) },
    { label: 'Delivered at', value: fmtDateTime(shipment.deliveredAt) },
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

function TransitionControls({
  shipment,
  onTransitioned,
}: {
  shipment: Shipment;
  onTransitioned: (updated: Shipment) => void;
}) {
  const legalNext = SHIPMENT_VALID_TRANSITIONS[shipment.status];
  const [busy, setBusy] = useState<ShipmentStatus | null>(null);
  const [err, setErr] = useState<string>('');

  async function transition(to: ShipmentStatus) {
    if (busy) return;
    setBusy(to);
    setErr('');
    try {
      const res = await apiPost<{ ok: boolean; shipment: Shipment }>(
        `/shipments/${encodeURIComponent(shipment.externalId)}/transition`,
        { toStatus: to },
      );
      onTransitioned(res.shipment);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Transition failed.');
    } finally {
      setBusy(null);
    }
  }

  if (legalNext.length === 0) {
    return (
      <section className="mb-10 border border-[var(--color-navy-line)] p-6">
        <h2 className="font-serif text-xl mb-1">State machine</h2>
        <p className="font-mono text-xs text-white/45">
          Status <span className="text-white">{statusLabel(shipment.status)}</span> is terminal. No further transitions available.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl">State machine</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/55">
          Current: {statusLabel(shipment.status)}
        </span>
      </div>
      <div className="px-6 py-5 flex flex-wrap gap-2">
        {legalNext.map((to) => (
          <button
            key={to}
            type="button"
            onClick={() => transition(to)}
            disabled={!!busy}
            className="px-3 py-1.5 border border-[var(--color-ivory)]/30 text-[11px] font-mono uppercase tracking-[0.1em] hover:border-[var(--color-ivory)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === to ? 'Transitioning…' : `→ ${statusLabel(to)}`}
          </button>
        ))}
      </div>
      {err && <div className="px-6 pb-5 text-[var(--color-critical)] text-[11px]">{err}</div>}
    </section>
  );
}

function ExceptionPanel({ shipment }: { shipment: Shipment }) {
  const ex = shipment.exceptionState || {};
  const acknowledged = Boolean(ex.acknowledgedAt);
  return (
    <section className="mb-10 border" style={{ borderColor: 'var(--color-critical)' }}>
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl text-[var(--color-critical)]">Exception</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-critical)' }}>
          {acknowledged ? 'Acknowledged' : 'Open'}
        </span>
      </div>
      <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-6">
        <Field label="Reason" value={ex.reason || '—'} />
        <Field label="Previous status" value={ex.previousStatus ? statusLabel(ex.previousStatus) : '—'} />
        <Field label="Opened at" value={fmtDateTime(ex.openedAt)} />
        <Field label="Acknowledged at" value={fmtDateTime(ex.acknowledgedAt)} />
        {ex.acknowledgmentNote && <Field label="Note" value={ex.acknowledgmentNote} fullWidth />}
      </div>
    </section>
  );
}

function ReferencesPanel({ shipment }: { shipment: Shipment }) {
  const hasGoods = !!shipment.goodsExternalId;
  const hasSupplier = !!shipment.supplierExternalId;
  if (!hasGoods && !hasSupplier) return null;
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)]">
        <h2 className="font-serif text-xl">References</h2>
      </div>
      <div className="px-6 py-5 grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-6">
        {hasGoods && <Field label="Goods master" value={shipment.goodsExternalId!} mono />}
        {hasSupplier && <Field label="Supplier master" value={shipment.supplierExternalId!} mono />}
      </div>
    </section>
  );
}

function DocumentVaultPanel({ shipment }: { shipment: Shipment }) {
  const docs = shipment.documentVault || [];
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)] flex items-center justify-between">
        <h2 className="font-serif text-xl">Document vault</h2>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-white/55">
          {docs.length} attached
        </span>
      </div>
      {docs.length === 0 ? (
        <p className="px-6 py-5 font-mono text-xs text-white/45">
          No documents attached yet. Document upload + filing ships with L1.4.
        </p>
      ) : (
        <ul>
          {docs.map((d, i) => (
            <li key={d.externalId || `${d.docType}-${i}`} className="px-6 py-3 border-t border-[var(--color-navy-line)] flex items-center justify-between gap-4">
              <div>
                <div className="font-serif text-[14px] text-white">{d.name || d.docType || 'Untitled document'}</div>
                <div className="font-mono text-[11px] text-white/45 mt-1">
                  {d.docType || '—'} · attached {fmtDateTime(d.attachedAt)}
                </div>
              </div>
              {d.url && (
                <a href={d.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/60 hover:text-white">
                  Open →
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SnapshotsPanel({ shipment }: { shipment: Shipment }) {
  const hasInputs = shipment.inputsSnapshot && Object.keys(shipment.inputsSnapshot).length > 0;
  const hasQuote = shipment.quoteSnapshot && Object.keys(shipment.quoteSnapshot).length > 0;
  if (!hasInputs && !hasQuote) return null;
  return (
    <section className="mb-10 border border-[var(--color-navy-line)]">
      <div className="px-6 py-4 border-b border-[var(--color-navy-line)]">
        <h2 className="font-serif text-xl">Reproducibility snapshots</h2>
        <p className="font-mono text-[11px] text-white/45 mt-1">
          The frozen inputs + quote behind this shipment. Used for audit + recompute.
        </p>
      </div>
      <div className="px-6 py-5 space-y-4">
        {hasInputs && <SnapshotBlock label="inputsSnapshot" value={shipment.inputsSnapshot!} />}
        {hasQuote && <SnapshotBlock label="quoteSnapshot" value={shipment.quoteSnapshot!} />}
      </div>
    </section>
  );
}

function SnapshotBlock({ label, value }: { label: string; value: Record<string, unknown> }) {
  const json = useMemo(() => JSON.stringify(value, null, 2), [value]);
  return (
    <details className="border border-[var(--color-navy-line)]">
      <summary className="cursor-pointer px-4 py-3 font-mono text-[11px] uppercase tracking-[0.12em] text-white/65 hover:text-white">
        {label}
      </summary>
      <pre className="px-4 py-3 font-mono text-[11px] text-white/70 overflow-x-auto whitespace-pre">{json}</pre>
    </details>
  );
}

function Field({ label, value, mono, fullWidth }: { label: string; value: string; mono?: boolean; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'md:col-span-2' : ''}>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{label}</div>
      <div className={`mt-1 ${mono ? 'font-mono text-[12px]' : 'text-[14px]'} text-white`}>{value}</div>
    </div>
  );
}
