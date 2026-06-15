'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { BorderBeam } from './border-beam';
import { NumberTicker } from './number-ticker';
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

// Subset of the /api/start response shape the success view reads.
// Matches lib/handlers/start.js composePlanWithRoadmap output. We
// intentionally type ONLY the fields we render so a future schema
// addition doesn't force a type churn here.
type TierAVerdict = {
  eligible: boolean;
  failedReason?: string;
  evaluatedAtIso?: string;
};
type GoodsMasterInheritance = {
  matched: boolean;
  sku: string;
  displayName?: string;
  inheritedFields: string[];
};
type StartResponse = {
  ok: boolean;
  plan?: {
    customs?: { tier_a?: TierAVerdict | null };
    sourcing?: { tier_a?: TierAVerdict | null };
    routing?: { tier_a?: TierAVerdict | null };
    finance?: { tier_a?: TierAVerdict | null };
    // warehouse has TWO branches at runtime: { skipped: true, reason } when
    // monthlyOrders < 100, or { ok, recommendation, recommendedHub, hubs,
    // tier_a } otherwise. The optional chain on plan.warehouse?.tier_a
    // narrows cleanly across both: skipped → undefined; populated →
    // verdict-or-null.
    warehouse?: { tier_a?: TierAVerdict | null };
    goodsMasterInheritance?: GoodsMasterInheritance | null;
  };
};

export function Wizard() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<FormData>(INITIAL);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [planResponse, setPlanResponse] = useState<StartResponse | null>(null);

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
      const json: StartResponse | null = await res.json().catch(() => null);
      if (!res.ok) {
        const errBag = (json as unknown) as { error?: string; errors?: string[] } | null;
        const detail: string =
          errBag?.error ||
          (errBag?.errors ? errBag.errors.join(', ') : '') ||
          `Plan endpoint returned ${res.status}`;
        throw new Error(detail);
      }
      setPlanResponse(json);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (status === 'success') {
    return <PlanResult data={data} planResponse={planResponse} />;
  }

  return (
    <section className="bg-[var(--color-ink)] py-20 md:py-28">
      <div className="mx-auto max-w-[860px] px-6">
        <ProgressRail current={step} />

        <form
          onSubmit={submit}
          className="relative isolate mt-12 overflow-hidden border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-8 md:p-12"
        >
          {/* Traces the perimeter of the active form — a soft ivory
              beam that orbits while the user is filling fields. Stays
              quiet (low contrast against navy) so it reads as life,
              not noise. */}
          <BorderBeam
            duration={12}
            size={260}
            colorFrom="rgba(250,250,247,0.7)"
            colorTo="rgba(250,250,247,0)"
          />

          <StepHeader number={step} label={STEP_LABELS[step - 1]} />

          {/* Animated step-body wrap — fades + slides between steps so
              the user feels the wizard advance rather than the content
              just blink. AnimatePresence keys the body off the step
              number; mode="wait" lets the outgoing step finish leaving
              before the incoming one enters. */}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >

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
            </motion.div>
          </AnimatePresence>

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
  const hasValue = value && value.length > 0;
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
      <div className="group relative">
        <select
          id={id}
          name={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className={`peer w-full appearance-none border-b border-[var(--color-navy-line)] bg-transparent pl-1 pr-10 py-2.5 text-[15px] cursor-pointer focus:border-[var(--color-ivory-dim)] focus:outline-none transition-colors duration-300 hover:border-[var(--color-ivory-dim)]/60 [&>option]:bg-[var(--color-ink)] [&>option]:text-[var(--color-ivory)] [&>option]:py-2 ${hasValue ? 'text-[var(--color-ivory)]' : 'text-[var(--color-ivory-mute)]'}`}
        >
          <option value="" disabled>
            {placeholder ?? '—'}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {/* Custom chevron — replaces the native macOS up/down arrows.
            Rotates 180° on focus so it nods open when the menu unfurls. */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center text-[var(--color-ivory-dim)] transition-all duration-300 peer-focus:text-[var(--color-ivory)] peer-focus:rotate-180 group-hover:text-[var(--color-ivory)]"
        >
          <svg width="11" height="6" viewBox="0 0 11 6" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M1 1l4.5 4L10 1"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
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

function PlanResult({ data, planResponse }: { data: FormData; planResponse: StartResponse | null }) {
  const customsValue = Number(data.customsValueEur);
  const validCustomsValue = Number.isFinite(customsValue) && customsValue > 0;
  const tierA = planResponse?.plan?.customs?.tier_a ?? null;
  const sourcingTierA = planResponse?.plan?.sourcing?.tier_a ?? null;
  const routingTierA = planResponse?.plan?.routing?.tier_a ?? null;
  const financeTierA = planResponse?.plan?.finance?.tier_a ?? null;
  const warehouseTierA = planResponse?.plan?.warehouse?.tier_a ?? null;
  const inheritance = planResponse?.plan?.goodsMasterInheritance ?? null;
  return (
    <section className="relative isolate overflow-hidden border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-28">
      {/* Soft aurora wash on completion — the page should feel like
          something just landed. Kept subtle so the editorial copy
          still leads. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(60% 50% at 20% 0%, rgba(250,250,247,0.06), transparent 60%), radial-gradient(40% 60% at 100% 100%, rgba(96,165,250,0.05), transparent 60%)',
        }}
      />
      <div className="mx-auto max-w-[820px] px-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-4"
        >
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
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="mt-10 font-serif text-[clamp(2rem,3.4vw+0.4rem,3rem)] leading-[1.06] tracking-[-0.02em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          The plan is on its way to {data.email}.
        </motion.h2>

        <p className="mt-7 max-w-[58ch] font-serif text-[1.1rem] italic leading-[1.55] text-[var(--color-ivory-dim)]">
          We have queued the calculator-grounded plan for the lane you described.
          Expect it in your inbox within a minute. A founder will follow up
          within one business day with the human read.
        </p>

        {/*
          Plan signal pills. The Tier-A pill renders only when this
          quote's customs calculation qualified for the ADR-0020
          eligibility gate. Wording mirrors the email template (PR #92):
          we describe what eligibility MEANS and call out the
          underwriter-grade accuracy guarantee as forthcoming (Q1 2027,
          subject to E&O binding) — never claiming an active guarantee.
          A drift-guard test pins both rules.
        */}
        {(tierA?.eligible === true || sourcingTierA?.eligible === true || routingTierA?.eligible === true || financeTierA?.eligible === true || warehouseTierA?.eligible === true || inheritance) && (
          <div className="mt-10 flex flex-wrap items-center gap-3">
            {tierA?.eligible === true && (
              <span
                role="status"
                aria-label="Tier-A · underwriter-grade duty calculation"
                className="inline-flex items-center gap-2 border border-[var(--color-ivory)]/30 bg-[var(--color-navy-soft)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ivory)]"
                title="This duty calculation cited primary-regulator sources (EU TARIC live rates) snapshotted within the last 30 days, was produced by our regression-tested customs calculator, and carried no manual overrides. Our liability-bearing accuracy guarantee for Tier-A calculations launches Q1 2027 (E&O insurance, subject to binding). Until then, Tier-A is a transparency signal you can audit, not a financial guarantee."
              >
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-positive,_#10B981)]" />
                Tier-A · duty
              </span>
            )}
            {/*
              Sourcing pill. Renders only when plan.sourcing.tier_a.eligible
              === true. Wording mirrors the email block from PR #111 — same
              forthcoming-guarantee discipline, sourcing-specific subject.
              A drift-guard test pins both rules in lockstep with the
              customs pill from PR #98.
            */}
            {sourcingTierA?.eligible === true && (
              <span
                role="status"
                aria-label="Tier-A · underwriter-grade sourcing comparison"
                className="inline-flex items-center gap-2 border border-[var(--color-ivory)]/30 bg-[var(--color-navy-soft)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ivory)]"
                title="This sourcing recommendation cited primary-regulator sources (international trade indices) snapshotted within the last 30 days, was produced by our regression-tested sourcing calculator, and carried no manual overrides. Our liability-bearing accuracy guarantee for Tier-A calculations launches Q1 2027 (E&O insurance, subject to binding). Until then, Tier-A is a transparency signal you can audit, not a financial guarantee."
              >
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-positive,_#10B981)]" />
                Tier-A · sourcing
              </span>
            )}
            {/*
              Routing pill (PR #115). Renders only when plan.routing.
              tier_a.eligible === true. Same wording discipline as
              customs / sourcing pills — forthcoming-guarantee, no
              active-guarantee claims, calculator-specific subject
              ("freight quote"). A drift-guard test pins all three.
            */}
            {routingTierA?.eligible === true && (
              <span
                role="status"
                aria-label="Tier-A · underwriter-grade freight quote"
                className="inline-flex items-center gap-2 border border-[var(--color-ivory)]/30 bg-[var(--color-navy-soft)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ivory)]"
                title="This routing recommendation cited primary-regulator sources (carrier-published rate indices) snapshotted within the last 30 days, was produced by our regression-tested routing calculator, and carried no manual overrides. Our liability-bearing accuracy guarantee for Tier-A calculations launches Q1 2027 (E&O insurance, subject to binding). Until then, Tier-A is a transparency signal you can audit, not a financial guarantee."
              >
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-positive,_#10B981)]" />
                Tier-A · routing
              </span>
            )}
            {/*
              Finance pill (this PR). Renders only when plan.finance.
              tier_a.eligible === true. Same wording discipline as
              customs / sourcing / routing pills — forthcoming-guarantee,
              no active-guarantee claims, calculator-specific subject
              ("financing recommendation"). A drift-guard test pins
              all four.
            */}
            {financeTierA?.eligible === true && (
              <span
                role="status"
                aria-label="Tier-A · underwriter-grade financing recommendation"
                className="inline-flex items-center gap-2 border border-[var(--color-ivory)]/30 bg-[var(--color-navy-soft)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ivory)]"
                title="This financing recommendation cited primary-regulator sources (central-bank rate tables) snapshotted within the last 30 days, was produced by our regression-tested finance calculator, and carried no manual overrides. Our liability-bearing accuracy guarantee for Tier-A calculations launches Q1 2027 (E&O insurance, subject to binding). Until then, Tier-A is a transparency signal you can audit, not a financial guarantee."
              >
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-positive,_#10B981)]" />
                Tier-A · finance
              </span>
            )}
            {/*
              Warehouse pill (this PR). Renders only when plan.warehouse.
              tier_a.eligible === true — and only on the populated
              branch of plan.warehouse (skipped state has no tier_a
              key, so the optional chain narrows to undefined). Same
              wording discipline as the four predecessor pills —
              forthcoming-guarantee, no active-guarantee claims,
              calculator-specific subject ("warehouse quote"). A
              drift-guard test pins all five.
            */}
            {warehouseTierA?.eligible === true && (
              <span
                role="status"
                aria-label="Tier-A · underwriter-grade warehouse quote"
                className="inline-flex items-center gap-2 border border-[var(--color-ivory)]/30 bg-[var(--color-navy-soft)]/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ivory)]"
                title="This warehouse recommendation cited primary-regulator sources (EU Eurostat warehousing producer-price indices) snapshotted within the last 30 days, was produced by our regression-tested warehouse calculator, and carried no manual overrides. Our liability-bearing accuracy guarantee for Tier-A calculations launches Q1 2027 (E&O insurance, subject to binding). Until then, Tier-A is a transparency signal you can audit, not a financial guarantee."
              >
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-positive,_#10B981)]" />
                Tier-A · warehouse
              </span>
            )}
            {inheritance && inheritance.matched && (
              <span
                role="status"
                aria-label={`Inherited from your goods master: ${inheritance.sku}`}
                className="inline-flex items-center gap-2 border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ivory-dim)]"
                title={`HS code and origin inherited from your saved goods master record. SKU: ${inheritance.sku}${inheritance.displayName ? ` · ${inheritance.displayName}` : ''}. Inherited fields: ${inheritance.inheritedFields.join(', ') || 'none'}.`}
              >
                <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-ivory-dim)]/60" />
                From your goods master · {inheritance.sku}
              </span>
            )}
          </div>
        )}

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
              validCustomsValue ? (
                <>
                  €<NumberTicker value={customsValue} />
                </>
              ) : (
                '—'
              )
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
