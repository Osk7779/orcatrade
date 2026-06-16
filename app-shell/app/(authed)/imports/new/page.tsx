'use client';

// /imports/new — customer intent form.
//
// Two-step server interaction:
//   1. POST /api/imports  → creates the row in 'submitted' state
//   2. POST /api/imports/<id>/process → orchestrator runs synchronously,
//      transitions to 'awaiting_review' with shortlist + quote attached
//
// We do both in sequence on submit because (a) the orchestrator is fast
// in-process (<1s), (b) the customer expects "submit → see something"
// behaviour, (c) it's the v1 contract. Sprint 2 splits these for a
// background worker pipeline.
//
// On step 1 failure: we surface server-side validation errors inline.
// On step 2 failure: the row exists but didn't reach awaiting_review —
// we navigate to the detail page anyway so the customer (and team) can
// see the failure state and re-run from there.

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  apiGet,
  apiPost,
  ApiError,
  AuthError,
  IMPORT_REQUEST_QUANTITY_UNITS,
  type ImportRequest,
  type ImportRequestQuantityUnit,
} from '@/lib/api';

// Closed taxonomy for the destination dropdown — covers the EU members
// where OrcaTrade has a customs broker partner queued for v1. UK is
// included for the post-Brexit corridor.
const EU_DESTINATIONS = Object.freeze([
  { code: 'DE', name: 'Germany' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'PL', name: 'Poland' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'IE', name: 'Ireland' },
  { code: 'AT', name: 'Austria' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'SE', name: 'Sweden' },
  { code: 'DK', name: 'Denmark' },
  { code: 'GB', name: 'United Kingdom' },
]);

// Origin shortlist — the corridors OrcaTrade's Asia office covers.
// "Other" lets the customer type a free ISO-2 code.
const ASIA_ORIGINS = Object.freeze([
  { code: 'CN', name: 'China' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'IN', name: 'India' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'TR', name: 'Türkiye' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'MY', name: 'Malaysia' },
]);

const COMMON_CERTIFICATIONS = Object.freeze([
  'CE',
  'REACH',
  'RoHS',
  'EUDR',
  'FDA-food-contact',
  'OEKO-TEX',
  'GOTS-organic',
  'CB-electrical',
]);

type FormState = {
  label: string;
  productDescription: string;
  hsCodeGuess: string;
  targetQuantity: string;
  targetQuantityUnit: ImportRequestQuantityUnit;
  targetUnitPriceEur: string;
  originCountry: string;
  destinationCountry: string;
  targetDeliveryDate: string;
  certifications: string[];
};

const EMPTY_FORM: FormState = {
  label: '',
  productDescription: '',
  hsCodeGuess: '',
  targetQuantity: '',
  targetQuantityUnit: 'pieces',
  targetUnitPriceEur: '',
  originCountry: 'CN',
  destinationCountry: 'DE',
  targetDeliveryDate: '',
  certifications: [],
};

// Sprint 13 ch 2 (+ Sprint 16 reuse) — prefill helper. Maps a
// persisted ImportRequest onto the new-request FormState. Used by
// BOTH flows on /imports/new:
//   • `?duplicate=ir_xxx` — customer wants another order like the prior
//     one (sprint 13). Label suffix: " (copy)".
//   • `?revise=ir_xxx`   — customer is responding to a structured
//     decline reason (sprint 16). Label suffix: " (revised)".
//
// The two suffixes are different so the new row reads correctly on
// the dashboard widget + the list view ("My LED order (revised)"
// is a different intent than "My LED order (copy)").
//
// Pure function — drift-guarded by tests that read this file and
// assert every load-bearing intent field is carried across.
//
// Fields deliberately RESET (not carried):
//   • targetDeliveryDate — likely stale (a duplicate/revision is for a
//     NEW order, not a re-run of the original)
//   • label — re-derived per the suffix above so the new row is
//     visually distinct from its source on the list view
//
// All other intent fields (productDescription, HS guess, quantity,
// unit price, origin, destination, certifications) carry over as-is.
export function buildFormFromRequest(
  request: ImportRequest,
  mode: 'duplicate' | 'revise' = 'duplicate',
): FormState {
  const unit = (request.targetQuantityUnit || 'pieces') as ImportRequestQuantityUnit;
  const suffix = mode === 'revise' ? '(revised)' : '(copy)';
  return {
    label: request.label ? `${request.label} ${suffix}` : '',
    productDescription: request.productDescription || '',
    hsCodeGuess: request.hsCodeGuess || '',
    targetQuantity: request.targetQuantity ? String(request.targetQuantity) : '',
    targetQuantityUnit: unit,
    targetUnitPriceEur: Number.isFinite(Number(request.targetUnitPriceCents))
      ? (Number(request.targetUnitPriceCents) / 100).toFixed(2)
      : '',
    originCountry: request.originCountry || 'CN',
    destinationCountry: request.destinationCountry || 'DE',
    targetDeliveryDate: '',
    certifications: Array.isArray(request.certificationRequirements)
      ? request.certificationRequirements.slice()
      : [],
  };
}

export default function NewImportRequestPage() {
  return (
    <Suspense fallback={<p className="text-[var(--color-ivory-mute)] text-sm">Loading…</p>}>
      <NewImportRequestForm />
    </Suspense>
  );
}

function NewImportRequestForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Sprint 13: `?duplicate=ir_xxx` — customer wants another like that.
  // Sprint 16: `?revise=ir_xxx`   — customer is responding to a
  //   structured decline. Only one is honoured per page load; revise
  //   wins if both are present (the more specific intent).
  const reviseFrom = searchParams.get('revise');
  const duplicateFrom = searchParams.get('duplicate');
  const mode: 'duplicate' | 'revise' | null = reviseFrom
    ? 'revise'
    : duplicateFrom
      ? 'duplicate'
      : null;
  const prefillFrom = reviseFrom || duplicateFrom;
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'creating' | 'processing'>('idle');
  const [errors, setErrors] = useState<string[]>([]);
  // Track whether the form was hydrated from a source request so we
  // can render the right banner. A failed source-fetch leaves the
  // form empty (user types fresh) — better than a noisy error.
  const [prefillLoading, setPrefillLoading] = useState<boolean>(!!prefillFrom);
  const [prefillSource, setPrefillSource] = useState<ImportRequest | null>(null);

  useEffect(() => {
    if (!prefillFrom || !mode) return;
    let cancelled = false;
    apiGet<{ ok: boolean; importRequest: ImportRequest }>(`/imports/${encodeURIComponent(prefillFrom)}`)
      .then((d) => {
        if (cancelled || !d || !d.importRequest) return;
        const next = buildFormFromRequest(d.importRequest, mode);
        setForm(next);
        setPrefillSource(d.importRequest);
        setPrefillLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPrefillLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [prefillFrom, mode]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleCertification(cert: string) {
    setForm((f) =>
      f.certifications.includes(cert)
        ? { ...f, certifications: f.certifications.filter((c) => c !== cert) }
        : { ...f, certifications: [...f.certifications, cert] },
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setErrors([]);
    setSubmitting(true);
    setPhase('creating');
    try {
      const targetQuantityNum = form.targetQuantity ? Number(form.targetQuantity) : undefined;
      const targetUnitPriceCents = form.targetUnitPriceEur
        ? Math.round(Number(form.targetUnitPriceEur) * 100)
        : undefined;

      const createPayload: Record<string, unknown> = {
        label: form.label.trim() || form.productDescription.slice(0, 60),
        productDescription: form.productDescription.trim(),
        destinationCountry: form.destinationCountry,
      };
      if (form.originCountry) createPayload.originCountry = form.originCountry;
      if (form.hsCodeGuess) createPayload.hsCodeGuess = form.hsCodeGuess;
      if (targetQuantityNum && Number.isFinite(targetQuantityNum)) {
        createPayload.targetQuantity = Math.round(targetQuantityNum);
        createPayload.targetQuantityUnit = form.targetQuantityUnit;
      }
      if (targetUnitPriceCents && Number.isFinite(targetUnitPriceCents) && targetUnitPriceCents > 0) {
        createPayload.targetUnitPriceCents = targetUnitPriceCents;
      }
      if (form.targetDeliveryDate) createPayload.targetDeliveryDate = form.targetDeliveryDate;
      if (form.certifications.length) createPayload.certificationRequirements = form.certifications;

      // Sprint 16 — carry the revision lineage on submit. The data
      // layer verifies same-org existence before insert (a cross-org
      // reference would be rejected with a 400). Only set on the
      // revise flow; ?duplicate intentionally creates an unlinked row.
      if (mode === 'revise' && reviseFrom) {
        createPayload.revisedFromExternalId = reviseFrom;
      }

      const created = await apiPost<{ ok: boolean; importRequest: ImportRequest }>(
        '/imports',
        createPayload,
      );
      if (!created.importRequest || !created.importRequest.externalId) {
        throw new Error('Server did not return a new request id');
      }

      // Auto-trigger the orchestrator. We swallow non-fatal errors so
      // the user still sees the row in its current state — the detail
      // page will render whatever state the row is in.
      setPhase('processing');
      try {
        await apiPost(`/imports/${created.importRequest.externalId}/process`, {});
      } catch (procErr) {
        // Log but don't block — the row is created either way.
        console.warn('process step failed', procErr);
      }

      router.push(`/imports/${created.importRequest.externalId}`);
    } catch (err) {
      if (err instanceof AuthError) {
        setErrors(['Please sign in to submit an import request.']);
      } else if (err instanceof ApiError) {
        setErrors(err.errors.length ? err.errors : [err.message]);
      } else {
        setErrors([err instanceof Error ? err.message : 'Submission failed']);
      }
      setPhase('idle');
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-16 max-w-3xl pb-16">
      {/* Hero — Connectis-inspired: bold Inter display, aqua glow accent,
          generous vertical air. Tagline (subtitle) retains a touch of
          serif italic as OrcaTrade's editorial signature. */}
      <header className="relative pt-4">
        <div
          aria-hidden
          className="absolute -top-8 -left-8 w-64 h-64 pointer-events-none rounded-full"
          style={{
            background: 'radial-gradient(closest-side, var(--color-aqua-glow), transparent)',
            filter: 'blur(8px)',
          }}
        />
        <div className="relative space-y-6">
          <div className="flex items-center gap-2 text-[12px] tracking-[0.06em] text-[var(--color-ivory-mute)]">
            <Link
              href="/imports"
              className="hover:text-[var(--color-aqua)] transition-colors"
            >
              Imports
            </Link>
            <span aria-hidden>›</span>
            <span className="text-[var(--color-ivory-dim)]">New request</span>
          </div>
          <h1 className="font-sans text-[clamp(2.5rem,5vw,3.75rem)] font-bold text-[var(--color-ivory)] tracking-[-0.025em] leading-[1.05]">
            Tell us what you want{' '}
            <span className="text-[var(--color-aqua)]">from Asia.</span>
          </h1>
          <p className="text-[var(--color-ivory-dim)] text-[17px] leading-relaxed max-w-2xl">
            We will surface a factory shortlist and a fully landed-cost quote — duty, VAT, freight, finance, OrcaTrade fee — within a few minutes.
            You can edit, cancel, or approve from the detail view.
          </p>
          <p className="font-serif italic text-[14px] text-[var(--color-ivory-mute)]/80 max-w-2xl">
            One number. One accountable party. One pallet at your warehouse.
          </p>
        </div>
      </header>

      {/* Sprint 13 ch 2 + Sprint 16 — prefill-source banner. Surfaces
          when the user landed here via "Duplicate this request →" or
          via the "Revise this request" link in a structured-decline
          email. Banner copy diverges per mode so the user knows what
          they're responding to. */}
      {prefillFrom && mode && (
        <div
          className="bg-[var(--color-aqua-soft)] border border-[var(--color-aqua)]/25 p-4 flex items-center justify-between gap-4 flex-wrap"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <div className="text-[13px] text-[var(--color-ivory-dim)] leading-snug">
            {prefillLoading ? (
              mode === 'revise'
                ? (<>Revising <span className="font-mono">{prefillFrom}</span> — pre-filling…</>)
                : (<>Duplicating from <span className="font-mono">{prefillFrom}</span> — pre-filling…</>)
            ) : prefillSource ? (
              mode === 'revise'
                ? (
                    <>
                      Revising your earlier request{' '}
                      <Link
                        href={`/imports/${prefillFrom}`}
                        className="text-[var(--color-aqua)] font-medium hover:underline font-mono"
                      >
                        {prefillFrom}
                      </Link>
                      . Make the change the team flagged, then resubmit — we will re-quote.
                    </>
                  )
                : (
                    <>
                      Pre-filled from your earlier request{' '}
                      <Link
                        href={`/imports/${prefillFrom}`}
                        className="text-[var(--color-aqua)] font-medium hover:underline font-mono"
                      >
                        {prefillFrom}
                      </Link>
                      . Edit anything below, then submit a fresh request.
                    </>
                  )
            ) : (
              <>Could not load <span className="font-mono">{prefillFrom}</span> — start fresh below.</>
            )}
          </div>
          {prefillSource && (
            <button
              type="button"
              onClick={() => { setForm(EMPTY_FORM); setPrefillSource(null); }}
              className="text-[12px] font-medium text-[var(--color-ivory-mute)] hover:text-[var(--color-aqua)] transition-colors shrink-0"
            >
              Clear and start fresh
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-12">
        {/* ── What ────────────────────────────────────────────── */}
        <Section heading="What you want to import" caption="The freer the description, the better the AI can shortlist factories.">
          <Field label="Short label (optional)" hint="A name only you see — e.g. ‘Q3 silicone mats launch’.">
            <input
              type="text"
              value={form.label}
              onChange={(e) => update('label', e.target.value)}
              maxLength={200}
              className="form-input"
              placeholder="Q3 silicone mats launch"
            />
          </Field>
          <Field
            label="Product description"
            hint="What is the product, what is it made of, what is it for, what certifications does it need?"
            required
          >
            <textarea
              value={form.productDescription}
              onChange={(e) => update('productDescription', e.target.value)}
              required
              minLength={10}
              maxLength={4000}
              rows={5}
              className="form-input"
              placeholder="3,000 silicone kitchen mats, food-grade, 30×40cm, FDA-compliant, EU-ready packaging."
            />
          </Field>
          <Field label="HS code guess (optional)" hint="If you already know the customs code. 6-10 digits.">
            <input
              type="text"
              value={form.hsCodeGuess}
              onChange={(e) => update('hsCodeGuess', e.target.value.replace(/[^0-9]/g, ''))}
              maxLength={10}
              className="form-input font-mono w-48"
              placeholder="3924100000"
            />
          </Field>
        </Section>

        {/* ── How much ────────────────────────────────────────── */}
        <Section heading="How much" caption="Order size + target landed price. Both optional — the team can refine.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Field label="Quantity">
              <input
                type="number"
                min={1}
                value={form.targetQuantity}
                onChange={(e) => update('targetQuantity', e.target.value)}
                className="form-input"
                placeholder="3000"
              />
            </Field>
            <Field label="Unit">
              <select
                value={form.targetQuantityUnit}
                onChange={(e) => update('targetQuantityUnit', e.target.value as ImportRequestQuantityUnit)}
                className="form-input"
              >
                {IMPORT_REQUEST_QUANTITY_UNITS.map((u) => (
                  <option key={u} value={u}>{u.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </Field>
            <Field label="Target landed unit price (EUR)" hint="What you'd like to sell or pay per unit, all-in.">
              <input
                type="number"
                step="0.01"
                min={0}
                value={form.targetUnitPriceEur}
                onChange={(e) => update('targetUnitPriceEur', e.target.value)}
                className="form-input"
                placeholder="13.00"
              />
            </Field>
          </div>
        </Section>

        {/* ── Route ───────────────────────────────────────────── */}
        <Section heading="Route" caption="Where it ships from and where you need it.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Field label="From (Asia)">
              <select
                value={form.originCountry}
                onChange={(e) => update('originCountry', e.target.value)}
                className="form-input"
              >
                {ASIA_ORIGINS.map((c) => (
                  <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                ))}
              </select>
            </Field>
            <Field label="To (EU)" required>
              <select
                value={form.destinationCountry}
                onChange={(e) => update('destinationCountry', e.target.value)}
                required
                className="form-input"
              >
                {EU_DESTINATIONS.map((c) => (
                  <option key={c.code} value={c.code}>{c.name} ({c.code})</option>
                ))}
              </select>
            </Field>
            <Field label="Target delivery date (optional)">
              <input
                type="date"
                value={form.targetDeliveryDate}
                onChange={(e) => update('targetDeliveryDate', e.target.value)}
                className="form-input"
              />
            </Field>
          </div>
        </Section>

        {/* ── Compliance ──────────────────────────────────────── */}
        <Section heading="Compliance needs" caption="Tick anything the product must satisfy. We size duty + paperwork accordingly.">
          <div className="flex flex-wrap gap-2">
            {COMMON_CERTIFICATIONS.map((c) => {
              const on = form.certifications.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCertification(c)}
                  className={`px-4 py-2 text-[13px] font-medium transition-all duration-200 ${
                    on
                      ? 'bg-[var(--color-aqua)] text-[var(--color-navy)] shadow-[0_2px_12px_rgba(34,211,238,0.35)]'
                      : 'border border-white/10 text-[var(--color-ivory-dim)] hover:border-[var(--color-aqua)]/50 hover:text-[var(--color-ivory)] hover:bg-white/[0.03]'
                  }`}
                  style={{ borderRadius: 'var(--radius-badge)' }}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Errors */}
        {errors.length > 0 && (
          <div
            className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/8 p-5 space-y-2"
            style={{ borderRadius: 'var(--radius-card)' }}
          >
            <p className="text-[13px] font-semibold text-[var(--color-critical)]">
              Could not submit
            </p>
            <ul className="text-[var(--color-ivory-dim)] text-[14px] list-disc pl-5 space-y-0.5">
              {errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Submit — aqua CTA with soft glow shadow */}
        <div className="flex items-center gap-6 pt-4">
          <button
            type="submit"
            disabled={submitting || form.productDescription.trim().length < 10}
            className="group inline-flex items-center gap-3 px-8 py-4 bg-[var(--color-aqua)] text-[var(--color-navy)] text-[15px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 hover:bg-[var(--color-aqua-dim)] hover:-translate-y-px disabled:translate-y-0"
            style={{
              borderRadius: 'var(--radius-button)',
              boxShadow: 'var(--shadow-cta)',
            }}
          >
            {phase === 'idle' && (
              <>
                Submit request
                <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
              </>
            )}
            {phase === 'creating' && 'Creating request…'}
            {phase === 'processing' && 'Generating shortlist + quote…'}
          </button>
          <Link
            href="/imports"
            className="text-[14px] text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)] transition-colors"
          >
            Cancel
          </Link>
        </div>
      </form>

      <style jsx>{`
        :global(.form-input) {
          width: 100%;
          padding: 0.75rem 1rem;
          background: rgba(255, 255, 255, 0.025);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: var(--radius-input);
          color: var(--color-ivory);
          font-size: 15px;
          line-height: 1.5;
          transition: border-color 200ms ease, background 200ms ease, box-shadow 200ms ease;
        }
        :global(.form-input:hover) {
          border-color: rgba(255, 255, 255, 0.16);
          background: rgba(255, 255, 255, 0.04);
        }
        :global(.form-input:focus) {
          outline: none;
          border-color: var(--color-aqua);
          background: rgba(255, 255, 255, 0.04);
          box-shadow: 0 0 0 4px var(--color-aqua-soft);
        }
        :global(.form-input::placeholder) {
          color: rgba(255, 255, 255, 0.3);
        }
        :global(select.form-input) {
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path fill='rgba(255,255,255,0.5)' d='M6 8.5L1.5 4l1-1L6 6.5 9.5 3l1 1z'/></svg>");
          background-repeat: no-repeat;
          background-position: right 0.875rem center;
          padding-right: 2.25rem;
        }
      `}</style>
    </section>
  );
}

function Section({
  heading,
  caption,
  children,
}: {
  heading: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="relative p-7 md:p-8 space-y-6 bg-[var(--surface-card)] backdrop-blur-[2px] border border-white/5 transition-shadow duration-300 hover:shadow-[var(--shadow-card-hover)]"
      style={{
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="space-y-2">
        <h2 className="text-[22px] font-semibold text-[var(--color-ivory)] tracking-[-0.01em]">
          {heading}
        </h2>
        <p className="text-[14px] text-[var(--color-ivory-mute)] leading-relaxed">
          {caption}
        </p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[13px] font-medium text-[var(--color-ivory-dim)]">
        {label}
        {required && (
          <span className="ml-1 text-[var(--color-aqua)]" aria-hidden>
            ·
          </span>
        )}
      </span>
      {children}
      {hint && (
        <span className="block text-[12.5px] text-[var(--color-ivory-mute)] leading-snug">
          {hint}
        </span>
      )}
    </label>
  );
}
