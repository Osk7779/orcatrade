import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Partners — OrcaTrade Group',
  description:
    'Curated partner ecosystem across freight, customs, finance, FX, insurance, inspections, and supplier vetting. Three relationship modes: Recommended, Referral, Commercial.',
};

type Mode = 'commercial' | 'referral' | 'recommended';

interface Partner {
  category: string;
  name: string;
  role: string;
  desc: string;
  mode: Mode;
}

const MODE_LABEL: Record<Mode, string> = {
  commercial: 'Commercial',
  referral: 'Referral',
  recommended: 'Recommended',
};

const MODE_CLASS: Record<Mode, string> = {
  commercial: 'border-[var(--color-ivory)]/45 text-[var(--color-ivory)] bg-[var(--color-ivory)]/[0.06]',
  referral: 'border-[var(--color-ivory-mute)]/45 text-[var(--color-ivory-dim)] bg-[var(--color-navy-soft)]/30',
  recommended: 'border-[var(--color-ivory-mute)]/35 text-[var(--color-ivory-mute)] bg-transparent',
};

const FREIGHT: Partner[] = [
  { category: 'Forwarder · Multimodal', name: 'Curated forwarder network', role: 'Sea + air + rail · Asia ↔ Europe', desc: 'A short list of forwarders we route shipments through, vetted for transit reliability, EU-side broker relationships, and rate transparency. Specifics shared at intake — different lanes prefer different operators.', mode: 'commercial' },
  { category: 'Customs broker · EU-wide', name: 'Bonded-warehouse network', role: 'Clearance + bonded + onward delivery', desc: 'A coordinated set of customs brokers across PL / DE / NL / IT / ES with bonded-warehouse access. Engaged on a per-shipment basis; consistent declaration discipline.', mode: 'referral' },
];

const INSPECTIONS: Partner[] = [
  { category: 'Inspection', name: 'QIMA', role: 'Pre-shipment + DUPRO + audits', desc: 'Recommended for buyers running multi-supplier programmes who need a consistent inspection methodology across factories. Pricing per inspection, pass-through.', mode: 'recommended' },
  { category: 'Inspection', name: 'AsiaInspection', role: 'Inspection + factory audit + lab testing', desc: 'Alternate to QIMA, often preferred for cosmetics, electronics, and specialised verticals where lab-test turnaround matters.', mode: 'recommended' },
  { category: 'Vetting · Supplier directory', name: 'Internal vetting team', role: 'OrcaTrade-curated supplier network', desc: 'Our own vetting pipeline for the OrcaTrade supplier directory. Compliance posture, capacity, sample turn, EU-grade documentation, and references from current EU clients.', mode: 'commercial' },
];

const COMPLIANCE: Partner[] = [
  { category: 'CBAM · EUDR specialist', name: 'Carbon-accounting consultancy network', role: 'Embedded-emissions data + DDS prep', desc: 'Specialised advisers for importers in CBAM-scope products (cement, steel, aluminium, fertilisers, hydrogen, electricity) needing actual-data filings post-2026. Referred when the compliance overlay flags more than the OrcaTrade engine can answer.', mode: 'referral' },
  { category: 'REACH · Cosmetics', name: 'EU Responsible Person network', role: 'CPNP notification + label conformity', desc: 'EU-based Responsible Persons for cosmetics importers. Required by Regulation (EC) 1223/2009 — we refer to vetted RPs across PL, DE, IT.', mode: 'referral' },
];

function PartnerCard({ p, i }: { p: Partner; i: number }) {
  return (
    <FadeUp delay={i * 0.04}>
      <div className="relative h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-5 transition-colors hover:border-[var(--color-ivory)]/30">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
          {p.category}
        </div>
        <div className="mt-2 font-serif text-[20px] leading-[1.2] text-[var(--color-ivory)]">
          {p.name}
        </div>
        <div className="mt-1 text-[13px] text-[var(--color-ivory-dim)]">{p.role}</div>
        <p className="mt-4 text-[14px] leading-[1.6] text-[var(--color-ivory-dim)]">{p.desc}</p>
        <span
          className={`mt-4 inline-block border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] ${MODE_CLASS[p.mode]}`}
        >
          {MODE_LABEL[p.mode]}
        </span>
      </div>
    </FadeUp>
  );
}

function PartnerSection({ numeral, label, partners }: { numeral: string; label: string; partners: Partner[] }) {
  return (
    <>
      <ChapterRule numeral={numeral} label={label} />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1100px] px-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {partners.map((p, i) => <PartnerCard key={p.name} p={p} i={i} />)}
          </div>
        </div>
      </section>
    </>
  );
}

export default function PartnersPage() {
  return (
    <>
      <EditorialHeader
        kicker="Partners"
        title={<>The OrcaTrade ecosystem.</>}
        lead="Importing from Asia is rarely one company's job. We curate a partner network across freight, customs, finance, FX, insurance, inspections, and supplier vetting — the people we recommend, the services we refer leads to, and the platforms we integrate with."
        meta="Recommended · Referral · Commercial — disclosed at the point of introduction"
      />

      <ChapterRule numeral="I" label="How we work with partners" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[860px] px-6">
          <FadeUp>
            <h2 className="font-serif text-[clamp(1.6rem,2.2vw+0.4rem,2.1rem)] leading-[1.2] tracking-[-0.02em] text-[var(--color-ivory)]"
                style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}>
              Three relationship modes.
            </h2>
            <div className="mt-7 space-y-4 text-[15px] leading-[1.65] text-[var(--color-ivory-dim)]">
              <p><strong className="text-[var(--color-ivory)]">Recommended</strong> — services we suggest customers use; no commercial relationship, just battle-tested referrals.</p>
              <p><strong className="text-[var(--color-ivory)]">Referral</strong> — partners we route qualified leads to, with a referral fee structure (always disclosed at the point of introduction).</p>
              <p><strong className="text-[var(--color-ivory)]">Commercial</strong> — embedded providers who power transactional services through OrcaTrade itself (freight, customs filings, inspections, hedging).</p>
            </div>
          </FadeUp>
        </div>
      </section>

      <PartnerSection numeral="II" label="Freight forwarding" partners={FREIGHT} />
      <PartnerSection numeral="III" label="Inspections + supplier vetting" partners={INSPECTIONS} />
      <PartnerSection numeral="IV" label="Compliance + regulatory" partners={COMPLIANCE} />

      <ChapterRule numeral="V" label="Become an OrcaTrade partner" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[760px] px-6 text-center">
          <FadeUp>
            <h2 className="font-serif text-[clamp(1.6rem,2.4vw+0.4rem,2.2rem)] leading-[1.2] tracking-[-0.02em] text-[var(--color-ivory)]"
                style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}>
              Selective by default. Earn placement through delivered quality.
            </h2>
            <p className="mt-6 text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              If you operate in any of the categories above and serve EU SMEs importing from Asia, talk to us. Added partners share our editorial stance on calibrated trust over breadth.
            </p>
            <Link
              href="/contact"
              className="mt-8 inline-block border border-[var(--color-ivory)] bg-[var(--color-ivory)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-ivory-dim)]"
            >
              Contact us
            </Link>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
