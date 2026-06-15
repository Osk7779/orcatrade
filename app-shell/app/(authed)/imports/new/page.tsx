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

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
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

export default function NewImportRequestPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'creating' | 'processing'>('idle');
  const [errors, setErrors] = useState<string[]>([]);

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
    <section className="space-y-10 max-w-3xl">
      <header className="space-y-3">
        <div className="flex items-baseline gap-3">
          <Link href="/imports" className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)]">
            ← Imports
          </Link>
        </div>
        <h1 className="font-serif text-4xl text-[var(--color-ivory)] tracking-[-0.02em]">
          New import request
        </h1>
        <p className="text-[var(--color-ivory-mute)] text-[15px] leading-relaxed">
          Describe what you want from Asia. We will surface a 2-3 factory shortlist and a fully
          landed-cost quote — duty, VAT, freight, finance, OrcaTrade fee — within a few minutes.
          You can edit, cancel, or approve from the detail view.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-10">
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
                  className={`px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] uppercase border transition-colors ${
                    on
                      ? 'border-[var(--color-ivory)] text-[var(--color-ivory)] bg-[var(--color-navy-soft)]/60'
                      : 'border-[var(--color-navy-line)] text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)] hover:border-[var(--color-ivory-mute)]'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </Section>

        {/* Errors */}
        {errors.length > 0 && (
          <div className="border border-[var(--color-critical)]/35 bg-[var(--color-critical)]/10 p-4 space-y-1">
            <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-[var(--color-critical)]">
              Could not submit
            </p>
            <ul className="text-[var(--color-ivory-mute)] text-sm list-disc pl-5">
              {errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={submitting || form.productDescription.trim().length < 10}
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--color-ivory)] text-[var(--color-navy)] font-mono text-[12px] tracking-[0.12em] uppercase hover:bg-[var(--color-ivory-dim)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {phase === 'idle' && (<>Submit request <span aria-hidden>→</span></>)}
            {phase === 'creating' && 'Creating request…'}
            {phase === 'processing' && 'Generating shortlist + quote…'}
          </button>
          <Link
            href="/imports"
            className="font-mono text-[11px] tracking-[0.12em] uppercase text-[var(--color-ivory-mute)] hover:text-[var(--color-ivory)]"
          >
            Cancel
          </Link>
        </div>
      </form>

      <style jsx>{`
        :global(.form-input) {
          width: 100%;
          padding: 0.625rem 0.875rem;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid var(--color-navy-line);
          color: var(--color-ivory);
          font-size: 14px;
          line-height: 1.4;
        }
        :global(.form-input:focus) {
          outline: none;
          border-color: var(--color-ivory-mute);
          background: rgba(0, 0, 0, 0.35);
        }
        :global(.form-input::placeholder) {
          color: rgba(255, 255, 255, 0.25);
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
    <section className="border-t border-[var(--color-navy-line)] pt-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-serif text-xl text-[var(--color-ivory)]">{heading}</h2>
        <p className="font-serif italic text-[var(--color-ivory-mute)] text-[13px]">{caption}</p>
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
    <label className="block space-y-1.5">
      <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-[var(--color-ivory-mute)]">
        {label}
        {required && <span className="ml-1 text-[var(--color-critical)]/80">*</span>}
      </span>
      {children}
      {hint && (
        <span className="block font-serif italic text-[12px] text-[var(--color-ivory-mute)]/70">
          {hint}
        </span>
      )}
    </label>
  );
}
