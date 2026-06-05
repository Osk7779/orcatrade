import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';
import { PricingTiers } from '@/components/marketing/pricing-tiers';
import { PricingFaq } from '@/components/marketing/pricing-faq';

export const metadata: Metadata = {
  title: 'Pricing — OrcaTrade Group',
  description:
    'Subscribe to access and intelligence. Pay per transaction for execution. Five tiers from Free to Enterprise, plus stackable add-on modules for compliance and reporting.',
};

const TIERS = [
  {
    name: 'Free',
    tierId: 'free',
    who: 'Lead-gen · evaluators',
    priceMonthly: '€0',
    priceUnit: 'forever',
    note: 'Permanent free tier',
    cta: { label: 'Start exploring', href: '/analysis', variant: 'ghost' as const },
    features: [
      '20 agent queries / month',
      '10 supplier views / month',
      '5 documents',
      '5 HS code lookups',
      'Free EU compliance brief (CBAM + EUDR, citation-grounded)',
    ],
  },
  {
    name: 'Starter',
    tierId: 'starter',
    who: 'Solo importers · FBA sellers',
    priceMonthly: '€99',
    priceAnnual: '€83',
    annualNote: 'billed annually · €990/yr (save €198)',
    // CTA opens Stripe Checkout via /api/billing/checkout. The button
    // also carries tierId/checkout=true so an authentication redirect
    // can resume after sign-in.
    cta: { label: 'Get started', href: '/api/billing/checkout', variant: 'solid' as const, checkout: true },
    features: [
      '200 agent queries / month',
      'Full Factory Search access',
      'Compliance + Sourcing agents',
      '5 supplier monitors',
      '5% off shipment fees',
    ],
  },
  {
    name: 'Growth',
    tierId: 'growth',
    who: 'Established SMEs · 5–50 shipments / yr',
    priceMonthly: '€399',
    priceAnnual: '€333',
    annualNote: 'billed annually · €3,990/yr (save €798)',
    popular: true,
    cta: { label: 'Get started', href: '/api/billing/checkout', variant: 'solid' as const, checkout: true },
    features: [
      '1,000 agent queries / month',
      'All five agents (Sourcing, Compliance, Logistics, Finance, Operations)',
      '20 supplier monitors',
      '5 seats included',
      'Advanced analytics & exception queue',
      '10% off shipment fees',
    ],
  },
  {
    name: 'Scale',
    tierId: 'scale',
    who: 'Mid-market · 50+ shipments / yr',
    priceMonthly: '€999',
    priceAnnual: '€833',
    annualNote: 'billed annually · €9,990/yr (save €1,998)',
    cta: { label: 'Get started', href: '/api/billing/checkout', variant: 'solid' as const, checkout: true },
    features: [
      'Unlimited agent queries',
      'Custom agent training on your supplier base',
      '20 seats included',
      'API access (10k calls / month)',
      'Dedicated account manager',
      '15% off shipment fees',
    ],
  },
  {
    name: 'Enterprise',
    tierId: 'enterprise',
    who: 'Manufacturers · distributors · retail chains',
    priceMonthly: 'Custom',
    priceUnit: 'from €2,500',
    note: 'SLA · ERP integration · white-label',
    cta: { label: 'Talk to sales', href: '/contact', variant: 'ghost' as const },
    features: [
      'ERP integration (SAP · Dynamics · Comarch)',
      'White-label / private deployment',
      'Dedicated agents tuned to your data',
      'Multi-AM support · SLAs',
      'Volume-discounted shipment fees',
      'Compliance audit packages included',
    ],
  },
];

const ADDONS = [
  {
    name: 'Sustainability Reporting Pro',
    price: '€199',
    unit: '/ month',
    desc: 'Automated CBAM, EUDR, and Scope 3 emissions reporting per shipment, per supplier, aggregated annually.',
  },
  {
    name: 'Industry Compliance Pack',
    price: '€149',
    unit: '/ month, per industry',
    desc: 'Deep-dive vertical packs: Electronics · Textiles · Food · Toys · Cosmetics. Each includes industry-specific regulations and document templates.',
  },
  {
    name: 'Buyer Verification',
    price: '€99',
    unit: '/ month',
    desc: 'For exporters: score your European buyers using public registries (KRS, Handelsregister, Companies House) plus credit data.',
  },
  {
    name: 'Multi-currency Wallet',
    price: '€49',
    unit: '/ month or FX margin',
    desc: 'EUR, USD, CNY, HKD, PLN. Hold balances, hedge exposure, settle suppliers without bouncing through retail FX.',
  },
  {
    name: 'Premium Agent Pack',
    price: '€299',
    unit: '/ month',
    desc: 'Early access to new agents, custom system-prompt training on your historical shipments and supplier interactions.',
  },
  {
    name: 'Dedicated AM',
    price: 'Included',
    unit: 'in Scale & Enterprise',
    desc: 'Named account manager who knows your supplier base, your compliance posture, and your shipment cadence.',
  },
];

const SPLIT_LEFT = [
  'AI agents (Sourcing, Compliance, Logistics, Finance, Operations)',
  'Factory Search and supplier monitors',
  'Shipment dashboard and exception queue',
  'EU compliance engine (CBAM, EUDR, REACH, CE)',
  'Document templates and HS code lookups',
  'Workspace seats and API quotas',
];

const SPLIT_RIGHT = [
  'Per-shipment service fees (€150–€2,500 depending on tier)',
  'Freight forwarding markup (8–15% on freight cost)',
  'Customs clearance fees (per declaration)',
  'Inspection services (per inspection, pass-through to QIMA / AsiaInspection)',
  'Trade finance origination (% per deal)',
  'Cargo insurance premiums (per shipment, commission)',
];

const FAQ = [
  {
    q: 'Can I switch tiers later?',
    a: 'Yes — upgrade or downgrade any time. Annual subscribers get prorated credit on upgrades. Downgrades take effect at the end of the current billing cycle.',
  },
  {
    q: 'Is the Free tier really free forever?',
    a: "Yes. The Free tier is permanent and doesn't require a payment method. It's enough to evaluate the platform — but not enough to run a real import operation on. Free includes 20 agent queries, 10 supplier views, 5 documents, and 5 HS lookups per month, plus unlimited free CBAM analyses.",
  },
  {
    q: 'What does "agent query" mean?',
    a: 'One tool-using AI conversation. A simple "what duty applies?" is one query. A multi-turn supplier vet that calls factoryScore, then sanctions screen, then a country comparison still counts as one query — the platform meters by conversation, not by tool call.',
  },
  {
    q: 'How are EU VAT and Stripe handled?',
    a: 'Stripe Tax handles EU VAT on every subscription invoice. Reverse-charge applies where your VAT ID is on file. Per-shipment fees are invoiced at the point of execution by the relevant supplier (forwarder, broker, insurer) with VAT handled per their tax treatment.',
  },
  {
    q: 'Can I cancel mid-cycle?',
    a: "Yes. You stop paying immediately; access continues until the end of the cycle you've already paid for. No retention dark patterns; the cancel button is in /account/billing.",
  },
  {
    q: 'Do you offer a startup discount?',
    a: 'Companies under three years old, revenue under €1M, and not VC-funded above seed: 50% off the first 12 months on Growth or Scale. Apply via /contact with your company-house number and we will validate.',
  },
];

export default function PricingPage() {
  return (
    <>
      <EditorialHeader
        kicker="Pricing"
        title={
          <>
            Subscribe to access.
            <br className="hidden md:block" /> Pay per transaction for execution.
          </>
        }
        lead="Five tiers from Free to Enterprise. Subscriptions cover ongoing access to AI agents, intelligence, monitoring, and tooling — paid whether or not you ship this month. Per-shipment fees, freight markup, customs filings, and inspections stay transactional."
        meta="14-day trial on every paid tier · EU VAT via Stripe Tax · cancel any time"
      />

      <ChapterRule numeral="I" label="Tiers" />

      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1280px] px-6">
          <PricingTiers tiers={TIERS} />
          <p className="mt-10 text-center text-[13px] text-[var(--color-ivory-mute)]">
            All paid tiers include a 14-day trial. Cancel anytime. EU VAT handled via Stripe Tax.
          </p>
        </div>
      </section>

      <ChapterRule numeral="II" label="Add-on modules" />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1100px] px-6">
          <FadeUp>
            <div className="flex items-center gap-3">
              <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/55">❦</span>
              <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">Stack on top of any tier</span>
            </div>
            <h2
              className="mt-5 font-serif text-[clamp(1.8rem,2.8vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              High-value capabilities that don&rsquo;t belong inside core tiers.
            </h2>
            <p className="mt-5 max-w-[62ch] text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              Bolt them on when the workflow demands. Add-ons are billed alongside the subscription on the same Stripe invoice.
            </p>
          </FadeUp>

          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ADDONS.map((a, i) => (
              <FadeUp key={a.name} delay={i * 0.04}>
                <div className="h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-5 transition-colors hover:border-[var(--color-ivory)]/30">
                  <div className="font-serif text-[17px] leading-[1.3] text-[var(--color-ivory)]">{a.name}</div>
                  <div className="mt-2 font-mono text-[13px] text-[var(--color-ivory-dim)]">
                    {a.price} <span className="text-[var(--color-ivory-mute)]">{a.unit}</span>
                  </div>
                  <p className="mt-3 text-[13px] leading-[1.6] text-[var(--color-ivory-dim)]">{a.desc}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      <ChapterRule numeral="III" label="What's in vs out" />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1100px] px-6">
          <FadeUp>
            <div className="flex items-center gap-3">
              <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/55">❦</span>
              <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">Two revenue streams, one bill</span>
            </div>
            <h2
              className="mt-5 font-serif text-[clamp(1.8rem,2.8vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Subscriptions buy access. Per-shipment costs run separately.
            </h2>
          </FadeUp>

          <div className="mt-12 grid gap-4 md:grid-cols-2">
            {[
              { tag: 'Included in subscription', heading: 'Access · Intelligence · Tooling', items: SPLIT_LEFT },
              { tag: 'Transactional · pay-as-you-ship', heading: 'Execution · paid per use', items: SPLIT_RIGHT },
            ].map((col, i) => (
              <FadeUp key={col.tag} delay={i * 0.06}>
                <div className="h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/20 p-7">
                  <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                    {col.tag}
                  </div>
                  <h3 className="mt-3 font-serif text-[20px] leading-[1.25] text-[var(--color-ivory)]">
                    {col.heading}
                  </h3>
                  <ul className="mt-5 space-y-3">
                    {col.items.map((it) => (
                      <li key={it} className="flex gap-3 text-[14px] leading-[1.55] text-[var(--color-ivory-dim)]">
                        <span aria-hidden className="mt-2 inline-block h-px w-3 shrink-0 bg-[var(--color-ivory-mute)]" />
                        <span>{it}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      <ChapterRule numeral="IV" label="FAQ" />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[760px] px-6">
          <FadeUp>
            <h2
              className="font-serif text-[clamp(1.8rem,2.8vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Common questions before you commit.
            </h2>
          </FadeUp>
          <div className="mt-10">
            <PricingFaq entries={FAQ} />
          </div>
        </div>
      </section>
    </>
  );
}
