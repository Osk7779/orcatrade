import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Contact — OrcaTrade Group',
  description:
    'Tell us about your next import. We will respond within one business day.',
};

const FIELDS = [
  { id: 'name', label: 'Name', type: 'text', placeholder: 'Your full name', required: true },
  { id: 'company', label: 'Company', type: 'text', placeholder: 'Brand or company name', required: true },
  { id: 'email', label: 'Email', type: 'email', placeholder: 'you@company.com', required: true },
  { id: 'product-category', label: 'Product category', type: 'text', placeholder: 'e.g. consumer electronics, gifting, accessories' },
  { id: 'order-quantity', label: 'Estimated order quantity', type: 'text', placeholder: 'e.g. 5,000 units for first order' },
  { id: 'target-price', label: 'Target price', type: 'text', placeholder: 'EXW / FOB or landed cost per unit, with currency' },
  { id: 'incoterms', label: 'Preferred incoterms & destination', type: 'text', placeholder: 'e.g. FOB Shenzhen to Gdańsk, DAP Berlin warehouse' },
  { id: 'timeline', label: 'Target delivery timeline', type: 'text', placeholder: 'Desired delivery month, fixed launch or campaign dates' },
];

export default function ContactPage() {
  return (
    <>
      <EditorialHeader
        kicker="Get in touch"
        title={
          <>
            Tell us about your next import.
            <br className="hidden md:block" /> We&rsquo;ll respond within one business day.
          </>
        }
        lead="Share the rough shape of the order — product category, quantity, target price, where it&rsquo;s going. We&rsquo;ll come back with a calculator-grounded plan, not a quote we made up."
        meta="London · Warsaw · Hong Kong"
      />

      <section
        id="brief"
        data-chapter="The brief"
        className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
      >
        <div className="mx-auto max-w-[820px] px-6">
          <FadeUp>
            <h2
              className="font-serif text-[clamp(1.8rem,2.6vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.018em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Share the details of your next order.
            </h2>
            <p className="mt-6 max-w-[60ch] font-serif text-[1.05rem] italic leading-[1.55] text-[var(--color-ivory-dim)]">
              Optional fields help us cost the lane more precisely. None of them
              are required — we will follow up with the right questions either way.
            </p>
          </FadeUp>

          <FadeUp delay={0.1}>
            <form
              action="/api/contact"
              method="post"
              className="mt-12 flex flex-col gap-7 border border-[var(--color-navy-line)] bg-[var(--color-ink)]/60 p-8 md:p-12"
            >
              {FIELDS.map((f) => (
                <Field key={f.id} {...f} />
              ))}

              <TextareaField
                id="project"
                label="Product / project details"
                placeholder="Product type, key specs, target market, packaging requirements…"
              />

              <div className="mt-2 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-navy-line)] pt-7">
                <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                  We will respond within one business day.
                </span>
                <button
                  type="submit"
                  className="group inline-flex items-center gap-3 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white"
                >
                  Send the brief
                  <span
                    aria-hidden
                    className="transition-transform duration-500 group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </button>
              </div>
            </form>
          </FadeUp>
        </div>
      </section>

      <ChapterRule numeral="II" label="Or, the direct line" />

      <section
        id="direct"
        data-chapter="Direct line"
        data-chapter-numeral="II"
        className="bg-[var(--color-ink)] py-20 md:py-28"
      >
        <div className="mx-auto max-w-[820px] px-6">
          <FadeUp>
            <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2">
              <DirectCard
                kicker="Operations"
                label="hello@orcatradegroup.com"
                detail="The fastest way to start a brief if you already know what you need."
              />
              <DirectCard
                kicker="Investors & partnerships"
                label="oskar@orcatradegroup.com"
                detail="Founder direct. Pilot programme, capital, distribution conversations."
              />
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}

function Field({
  id,
  label,
  type,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  type: string;
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
      <input
        id={id}
        name={id}
        type={type}
        placeholder={placeholder}
        required={required}
        className="border-b border-[var(--color-navy-line)] bg-transparent py-2.5 text-[15px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
      />
    </label>
  );
}

function TextareaField({
  id,
  label,
  placeholder,
}: {
  id: string;
  label: string;
  placeholder?: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
        {label}
      </span>
      <textarea
        id={id}
        name={id}
        placeholder={placeholder}
        rows={5}
        className="resize-none border border-[var(--color-navy-line)] bg-transparent p-3 text-[15px] leading-[1.6] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
      />
    </label>
  );
}

function DirectCard({
  kicker,
  label,
  detail,
}: {
  kicker: string;
  label: string;
  detail: string;
}) {
  return (
    <a
      href={`mailto:${label}`}
      className="group flex flex-col gap-3 bg-[var(--color-ink)] p-8 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-10"
    >
      <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
        {kicker}
      </span>
      <span
        className="font-serif text-[1.35rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        {label}
      </span>
      <span className="font-serif text-[14px] italic leading-[1.55] text-[var(--color-ivory-dim)]">
        {detail}
      </span>
    </a>
  );
}
