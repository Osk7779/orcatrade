import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Vetted supplier directory — OrcaTrade Group',
  description:
    'Anonymised supplier exemplars. OrcaTrade-curated factories with vetted compliance posture, capacity, sample turn, and EU-grade documentation. Live directory access via subscription.',
};

const EXEMPLARS = [
  { category: 'Apparel · woven', country: 'CN', moq: '500 pcs', leadDays: '35–45', certifications: 'BSCI · OEKO-TEX', note: 'Knit + woven; private-label experience with 4 EU brands (currently NDA-protected).' },
  { category: 'Apparel · knit', country: 'VN', moq: '300 pcs', leadDays: '40–55', certifications: 'WRAP · GOTS', note: 'EVFTA preferential origin paperwork in-house. Sample 7 days.' },
  { category: 'Electronics · consumer', country: 'CN', moq: '1,000 pcs', leadDays: '30–40', certifications: 'CE · FCC · ISO 9001', note: 'Bluetooth + WiFi consumer goods; RED + RoHS technical files prepared.' },
  { category: 'Cosmetics', country: 'IN', moq: '1,000 units', leadDays: '50–70', certifications: 'GMP · ECOCERT', note: 'CPNP notification handled via Indian RP partner; REACH-compliant ingredient list.' },
  { category: 'Homeware · ceramic', country: 'CN', moq: '500 pcs', leadDays: '45–60', certifications: 'BSCI · FDA', note: 'Tableware-grade ceramics; anti-dumping aware (HS 6911 stoneware).' },
  { category: 'Footwear', country: 'VN', moq: '600 pairs', leadDays: '60–75', certifications: 'WRAP · LWG', note: 'Leather sourcing audit available. EUDR DDS support on request.' },
  { category: 'Furniture', country: 'CN', moq: '50 pcs', leadDays: '60–90', certifications: 'BSCI', note: 'Flat-pack + assembled. EUDR-aware on wood sourcing.' },
  { category: 'Machinery · parts', country: 'CN', moq: '20 pcs', leadDays: '60–80', certifications: 'ISO 9001 · CE', note: 'CE machinery directive technical files prepared; CN-origin AD risk flagged per HS.' },
];

const VETTING_STEPS = [
  ['Registration check', 'Business licence, registered capital, scope of business, years operating — cross-referenced against the public registry in the supplier\'s jurisdiction.'],
  ['Capacity sample', 'Real production photos with timestamp, recent shipment manifest excerpts, machine count and worker headcount cross-checked against stated capacity.'],
  ['Compliance posture', 'Existing certifications validated with issuing body. EU-specific overlays (REACH, EUDR, CBAM, RoHS, CE) noted per product category.'],
  ['Banking confirmation', 'Bank account name matches the registered entity. Suppliers asking for payment to a different name are flagged.'],
  ['EU client references', 'At least two reachable EU clients with comparable order volume. References checked for shipment quality + responsiveness on dispute.'],
  ['Sample turn', 'Time from PO to sample delivery measured against the supplier\'s stated lead time. A 30%+ slip is a non-pass.'],
];

export default function MarketplacePage() {
  return (
    <>
      <EditorialHeader
        kicker="Vetted supplier directory"
        title={
          <>
            Anonymised exemplars from
            <br className="hidden md:block" /> the curated network.
          </>
        }
        lead="OrcaTrade vets factories before adding them to the directory. The exemplars below are anonymised representatives of the supplier mix paid subscribers can search. We do not list every factory we know; we list ones we would order from ourselves."
        meta="Identity disclosed only to introduced buyers · NDA at first sample · paid-tier feature"
      />

      <ChapterRule numeral="I" label="Exemplars" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1100px] px-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {EXEMPLARS.map((ex, i) => (
              <FadeUp key={ex.category + i} delay={i * 0.04}>
                <div className="h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-5 transition-colors hover:border-[var(--color-ivory)]/30">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                      {ex.category}
                    </div>
                    <div className="border border-[var(--color-ivory-mute)]/40 px-2 py-0.5 font-mono text-[10px] text-[var(--color-ivory-dim)]">
                      {ex.country}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-ivory-mute)]">
                    <div>
                      <div>MOQ</div>
                      <div className="mt-0.5 normal-case tracking-normal text-[13px] text-[var(--color-ivory)]">{ex.moq}</div>
                    </div>
                    <div>
                      <div>Lead time</div>
                      <div className="mt-0.5 normal-case tracking-normal text-[13px] text-[var(--color-ivory)]">{ex.leadDays} days</div>
                    </div>
                  </div>
                  <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-ivory-mute)]">
                    Certifications
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--color-ivory-dim)]">{ex.certifications}</div>
                  <p className="mt-4 text-[13px] leading-[1.55] text-[var(--color-ivory-dim)]">{ex.note}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      <ChapterRule numeral="II" label="How we vet" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[860px] px-6">
          <FadeUp>
            <p className="max-w-[62ch] text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              Six steps before a factory enters the directory. Each step has a documented pass/fail; the file is shared with introduced buyers under NDA.
            </p>
            <ol className="mt-10 space-y-6">
              {VETTING_STEPS.map(([title, body], i) => (
                <li key={title as string} className="flex gap-5">
                  <div className="mt-1 min-w-[2.5rem] font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <div>
                    <div className="font-serif text-[17px] leading-[1.25] text-[var(--color-ivory)]">{title}</div>
                    <p className="mt-2 text-[14px] leading-[1.65] text-[var(--color-ivory-dim)]">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </FadeUp>
        </div>
      </section>

      <ChapterRule numeral="III" label="Access" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[760px] px-6 text-center">
          <FadeUp>
            <h2
              className="font-serif text-[clamp(1.6rem,2.2vw+0.4rem,2.1rem)] leading-[1.2] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Full directory access on the Starter tier and above.
            </h2>
            <p className="mt-6 text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              Identity disclosed only to introduced buyers; first sample under NDA; we facilitate the introduction and the first PO, then step back. No supplier kickback.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <Link href="/pricing" className="border border-[var(--color-ivory)] bg-[var(--color-ivory)] px-6 py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-ivory-dim)]">
                See pricing
              </Link>
              <Link href="/contact" className="border border-[var(--color-ivory)]/45 px-6 py-3 font-mono text-[12px] uppercase tracking-[0.14em] text-[var(--color-ivory)] transition-colors hover:border-[var(--color-ivory)] hover:bg-[var(--color-ivory)]/5">
                Talk to us first
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
