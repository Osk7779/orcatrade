'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  PRODUCT_CATEGORIES,
  ORIGIN_COUNTRIES,
  DESTINATIONS,
  PREFERENTIAL_OPTIONS,
  CURRENCIES,
} from '@/lib/wizard-options';

// Import Plan Builder. Six-step form, editorial aesthetic. On submit,
// POSTs to /api/plan (which sits in the root project; in dev-only
// marketing-shell runs, the call will fail gracefully and we offer the
// /contact path instead).

interface FormData {
  productCategory: string;
  productDescription: string;
  hsCode: string;
  originCountry: string;
  destinationCountry: string;
  customsValueEur: string;
  weightKg: string;
  linesCount: string;
  claimPreferential: string;
  quoteCurrency: string;
  paymentTermsDays: string;
  urgencyWeeks: string;
  monthlyOrders: string;
  email: string;
  company: string;
}

const INITIAL: FormData = {
  productCategory: '',
  productDescription: '',
  hsCode: '',
  originCountry: '',
  destinationCountry: '',
  customsValueEur: '',
  weightKg: '',
  linesCount: '4',
  claimPreferential: 'unsure',
  quoteCurrency: 'EUR',
  paymentTermsDays: '60',
  urgencyWeeks: '',
  monthlyOrders: '',
  email: '',
  company: '',
};

const STEP_LABELS = [
  'What are you importing?',
  'Where are you sourcing from?',
  'Where in the EU is it landing?',
  'How big is each shipment?',
  'Volume and urgency',
  'Where should we send the plan?',
];

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function Wizard() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(INITIAL);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const setField = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setData((p) => ({ ...p, [key]: value }));
  };

  const validate = (n: number): boolean => {
    if (n === 1) return Boolean(data.productCategory);
    if (n === 2) return Boolean(data.originCountry);
    if (n === 3) return Boolean(data.destinationCountry);
    if (n === 4) return Boolean(data.customsValueEur && data.weightKg);
    if (n === 5) return true;
    if (n === 6) return Boolean(data.email);
    return false;
  };

  const next = () => {
    if (!validate(step)) return;
    setStep((p) => Math.min(p + 1, 6));
  };
  const back = () => setStep((p) => Math.max(p - 1, 1));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate(6)) return;
    setStatus('submitting');
    setErrorMessage('');
    try {
      // Map the wizard's string-typed form data onto the /api/start handler's
      // expected shape: numeric fields parsed, blanks left undefined so
      // server-side defaults kick in. Endpoint is the real composePlan() at
      // lib/handlers/start.js — orchestrates sourcing + routing + customs +
      // warehouse calculators and (when email set) sends the plan via Resend.
      const payload: Record<string, unknown> = {
        productCategory: data.productCategory,
        productDescription: data.productDescription || undefined,
        hsCode: data.hsCode || undefined,
        originCountry: data.originCountry,
        destinationCountry: data.destinationCountry,
        customsValueEur: data.customsValueEur ? Number(data.customsValueEur) : undefined,
        weightKg: data.weightKg ? Number(data.weightKg) : undefined,
        linesCount: data.linesCount ? Number(data.linesCount) : undefined,
        claimPreferential: data.claimPreferential,
        quoteCurrency: data.quoteCurrency,
        paymentTermsDays: data.paymentTermsDays ? Number(data.paymentTermsDays) : undefined,
        urgencyWeeks: data.urgencyWeeks ? Number(data.urgencyWeeks) : undefined,
        monthlyOrders: data.monthlyOrders ? Number(data.monthlyOrders) : undefined,
        email: data.email,
        company: data.company || undefined,
      };
      const res = await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          (json && (json.error || (json.errors && json.errors.join(', ')))) ||
          `Plan endpoint returned ${res.status}`;
        throw new Error(detail);
      }
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (status === 'success') {
    return <PlanResult data={data} />;
  }

  return (
    <section className="bg-[var(--color-ink)] py-20 md:py-28">
      <div className="mx-auto max-w-[860px] px-6">
        <ProgressRail current={step} />

        <form
          onSubmit={submit}
          className="mt-12 border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-8 md:p-12"
        >
          <StepHeader number={step} label={STEP_LABELS[step - 1]} />

          {step === 1 && (
            <div className="mt-10 flex flex-col gap-7">
              <Select
                id="productCategory"
                label="Product category"
                value={data.productCategory}
                onChange={(v) => setField('productCategory', v)}
                options={PRODUCT_CATEGORIES}
                placeholder="Pick the closest category"
                required
              />
              <Field
                id="productDescription"
                label="Brief description"
                type="text"
                value={data.productDescription}
                onChange={(v) => setField('productDescription', v)}
                placeholder="e.g. cotton t-shirts, bluetooth speakers, oak dining tables"
                hint="Optional, but it helps us pick the right HS sub-line."
              />
              <Field
                id="hsCode"
                label="HS code"
                type="text"
                value={data.hsCode}
                onChange={(v) => setField('hsCode', v)}
                placeholder="6203 42 35"
                hint="Optional. Six to ten digits. We will find it if you don't have it."
              />
            </div>
          )}

          {step === 2 && (
            <div className="mt-10 flex flex-col gap-7">
              <Select
                id="originCountry"
                label="Origin country"
                value={data.originCountry}
                onChange={(v) => setField('originCountry', v)}
                options={ORIGIN_COUNTRIES}
                placeholder="Pick the country of origin"
                required
              />
              <div className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-6">
                <p className="font-serif text-[14px] italic leading-[1.55] text-[var(--color-ivory-dim)]">
                  Origin is where the goods <em>last underwent substantial
                  processing</em>, not where they were shipped from. A factory in
                  Türkiye finishing Chinese fabric is a different origin from a
                  factory in Türkiye knitting Turkish cotton.
                </p>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="mt-10 flex flex-col gap-7">
              <Select
                id="destinationCountry"
                label="EU destination"
                value={data.destinationCountry}
                onChange={(v) => setField('destinationCountry', v)}
                options={DESTINATIONS}
                placeholder="Pick the EU country of entry"
                required
              />
            </div>
          )}

          {step === 4 && (
            <div className="mt-10 flex flex-col gap-7">
              <div className="grid grid-cols-1 gap-7 md:grid-cols-2">
                <Field
                  id="customsValueEur"
                  label="Customs value (€)"
                  type="number"
                  value={data.customsValueEur}
                  onChange={(v) => setField('customsValueEur', v)}
                  placeholder="25000"
                  required
                  hint="CIF value at the EU border, in euros."
                />
                <Field
                  id="weightKg"
                  label="Total weight (kg)"
                  type="number"
                  value={data.weightKg}
                  onChange={(v) => setField('weightKg', v)}
                  placeholder="800"
                  required
                />
              </div>
              <div className="grid grid-cols-1 gap-7 md:grid-cols-2">
                <Field
                  id="linesCount"
                  label="Lines on the invoice"
                  type="number"
                  value={data.linesCount}
                  onChange={(v) => setField('linesCount', v)}
                  placeholder="4"
                />
                <Select
                  id="quoteCurrency"
                  label="Supplier quotes in"
                  value={data.quoteCurrency}
                  onChange={(v) => setField('quoteCurrency', v)}
                  options={CURRENCIES}
                  placeholder="EUR"
                />
              </div>
              <Select
                id="claimPreferential"
                label="Preferential origin claim?"
                value={data.claimPreferential}
                onChange={(v) => setField('claimPreferential', v)}
                options={PREFERENTIAL_OPTIONS}
                placeholder="Pick your preference posture"
              />
            </div>
          )}

          {step === 5 && (
            <div className="mt-10 flex flex-col gap-7">
              <div className="grid grid-cols-1 gap-7 md:grid-cols-2">
                <Field
                  id="paymentTermsDays"
                  label="Payment terms (days)"
                  type="number"
                  value={data.paymentTermsDays}
                  onChange={(v) => setField('paymentTermsDays', v)}
                  placeholder="60"
                />
                <Field
                  id="urgencyWeeks"
                  label="Deadline (weeks)"
                  type="number"
                  value={data.urgencyWeeks}
                  onChange={(v) => setField('urgencyWeeks', v)}
                  placeholder="16"
                  hint="Optional. Helps us route by lane fit."
                />
              </div>
              <Field
                id="monthlyOrders"
                label="Monthly orders (e-commerce)"
                type="number"
                value={data.monthlyOrders}
                onChange={(v) => setField('monthlyOrders', v)}
                placeholder="1500"
                hint="Optional. Used for the warehouse-fit and 3PL recommendations."
              />
            </div>
          )}

          {step === 6 && (
            <div className="mt-10 flex flex-col gap-7">
              <Field
                id="email"
                label="Where to send the plan"
                type="email"
                value={data.email}
                onChange={(v) => setField('email', v)}
                placeholder="you@company.com"
                required
              />
              <Field
                id="company"
                label="Company"
                type="text"
                value={data.company}
                onChange={(v) => setField('company', v)}
                placeholder="Your company name"
              />
              <div className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-6">
                <p className="font-serif text-[14px] italic leading-[1.55] text-[var(--color-ivory-dim)]">
                  We will send the calculator-grounded plan to this address within
                  sixty seconds of submitting, then a founder will follow up within
                  one business day if you want a human read on it.
                </p>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="mt-8 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-5">
              <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">
                We could not reach the plan service from here. {errorMessage}.{' '}
                You can send the brief through the contact form &mdash;{' '}
                <Link
                  href="/contact"
                  className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
                >
                  open the form
                </Link>{' '}
                &mdash; and we will compose the plan and reply within one business day.
              </p>
            </div>
          )}

          <Navigation
            step={step}
            canAdvance={validate(step)}
            onBack={back}
            onNext={next}
            onSubmit={() => {/* form onSubmit handles it */}}
            status={status}
          />
        </form>

        <p className="mt-6 text-center font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
          No payment to apply. Plan ready in roughly a minute.
        </p>
      </div>
    </section>
  );
}

function ProgressRail({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-3">
      {Array.from({ length: 6 }).map((_, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'active' : 'todo';
        return (
          <div key={n} className="flex flex-1 items-center gap-3">
            <span
              aria-hidden
              className={cn(
                'h-px flex-1 transition-colors duration-500',
                state === 'todo'
                  ? 'bg-[var(--color-navy-line)]'
                  : 'bg-[var(--color-ivory)]/70',
              )}
            />
            <span
              className={cn(
                'grid size-7 place-items-center border font-serif text-[12px] italic transition-colors duration-500',
                state === 'done' &&
                  'border-[var(--color-ivory)] bg-[var(--color-ivory)] text-[var(--color-ink)]',
                state === 'active' &&
                  'border-[var(--color-ivory)] text-[var(--color-ivory)]',
                state === 'todo' &&
                  'border-[var(--color-navy-line)] text-[var(--color-ivory-mute)]',
              )}
            >
              {n}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StepHeader({ number, label }: { number: number; label: string }) {
  return (
    <>
      <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
        § {toRoman(number)} · Step {number} of 6
      </span>
      <h2
        className="mt-3 font-serif text-[clamp(1.8rem,2.8vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        {label}
      </h2>
    </>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  required,
  hint,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
        {label}
        {required && (
          <span aria-hidden className="ml-1 text-[var(--color-ivory-mute)]">
            ·
          </span>
        )}
      </span>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="border-b border-[var(--color-navy-line)] bg-transparent py-2.5 text-[15px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
      />
      {hint && (
        <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
          {hint}
        </span>
      )}
    </label>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
        {label}
        {required && (
          <span aria-hidden className="ml-1 text-[var(--color-ivory-mute)]">
            ·
          </span>
        )}
      </span>
      <select
        id={id}
        name={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="border-b border-[var(--color-navy-line)] bg-transparent py-2.5 text-[15px] text-[var(--color-ivory)] focus:border-[var(--color-ivory-dim)] focus:outline-none [&>option]:bg-[var(--color-ink)] [&>option]:text-[var(--color-ivory)]"
      >
        <option value="" disabled className="text-[var(--color-ivory-mute)]">
          {placeholder ?? '—'}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Navigation({
  step,
  canAdvance,
  onBack,
  onNext,
  status,
}: {
  step: number;
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  status: Status;
}) {
  return (
    <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-navy-line)] pt-8">
      <button
        type="button"
        onClick={onBack}
        disabled={step === 1 || status === 'submitting'}
        className="inline-flex items-center gap-2 font-serif text-[13px] italic text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)] disabled:opacity-30"
      >
        <span aria-hidden>←</span> Back
      </button>

      {step < 6 ? (
        <button
          type="button"
          onClick={onNext}
          disabled={!canAdvance}
          className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
          <span
            aria-hidden
            className="transition-transform duration-500 group-hover:translate-x-0.5"
          >
            →
          </span>
        </button>
      ) : (
        <button
          type="submit"
          disabled={!canAdvance || status === 'submitting'}
          className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status === 'submitting' ? 'Composing the plan…' : 'Build my plan'}
          <span
            aria-hidden
            className="transition-transform duration-500 group-hover:translate-x-0.5"
          >
            →
          </span>
        </button>
      )}
    </div>
  );
}

function PlanResult({ data }: { data: FormData }) {
  return (
    <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-28">
      <div className="mx-auto max-w-[820px] px-6">
        <div className="flex items-center gap-4">
          <span className="h-px w-10 bg-[var(--color-ivory-dim)]/50" />
          <span
            aria-hidden
            className="font-serif text-[13px] text-[var(--color-ivory-dim)]/60"
          >
            ❦
          </span>
          <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
            Plan composed
          </span>
        </div>

        <h2
          className="mt-10 font-serif text-[clamp(2rem,3.4vw+0.4rem,3rem)] leading-[1.06] tracking-[-0.02em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          The plan is on its way to {data.email}.
        </h2>

        <p className="mt-7 max-w-[58ch] font-serif text-[1.1rem] italic leading-[1.55] text-[var(--color-ivory-dim)]">
          We have queued the calculator-grounded plan for the lane you described.
          Expect it in your inbox within a minute. A founder will follow up
          within one business day with the human read.
        </p>

        <div className="mt-12 grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-3">
          <Summary
            kicker="Origin"
            value={
              ORIGIN_COUNTRIES.find((o) => o.value === data.originCountry)?.label ?? '—'
            }
          />
          <Summary
            kicker="Destination"
            value={
              DESTINATIONS.find((d) => d.value === data.destinationCountry)?.label ??
              '—'
            }
          />
          <Summary
            kicker="Customs value"
            value={
              data.customsValueEur
                ? `€${Number(data.customsValueEur).toLocaleString('en-GB')}`
                : '—'
            }
          />
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 border border-[var(--color-navy-line)] px-6 py-3 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
          >
            Return to the homepage
          </Link>
          <Link
            href="/guides"
            className="group inline-flex items-center gap-2 font-serif text-[14px] italic text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
          >
            Read the reference library while you wait →
          </Link>
        </div>
      </div>
    </section>
  );
}

function Summary({ kicker, value }: { kicker: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 bg-[var(--color-ink)] p-7">
      <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
        {kicker}
      </span>
      <span
        className="font-serif text-[1.35rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        {value}
      </span>
    </div>
  );
}

function toRoman(n: number): string {
  const map = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
  return map[n] ?? String(n);
}
