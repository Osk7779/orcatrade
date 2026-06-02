import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Trade defence — OrcaTrade Group',
  description:
    'Anti-dumping and countervailing duties currently in force on Chinese commodities. Rates, chapters, carve-outs.',
};

// Active measures listed on the live site. Each links to the deep page
// with the rate, the publication reference, and the affected HS codes.
const MEASURES = [
  { slug: 'cn-e-bikes-ad', title: 'E-bikes — anti-dumping (CN)', detail: 'AD 70.1% on top of 10% MFN' },
  { slug: 'cn-e-bikes-cvd', title: 'E-bikes — countervailing (CN)', detail: 'CVD 17.2% on top of AD + MFN' },
  { slug: 'cn-aluminum-extrusions', title: 'Aluminium extrusions (CN)', detail: '32% AD on top of 6% MFN' },
  { slug: 'cn-aluminum-flat-rolled', title: 'Aluminium flat-rolled (CN)', detail: 'Active AD measure' },
  { slug: 'cn-aluminum-converter-foil', title: 'Aluminium converter foil (CN)', detail: 'Active AD measure' },
  { slug: 'cn-cold-rolled-steel', title: 'Cold-rolled steel (CN)', detail: 'AD on cold-rolled flat products' },
  { slug: 'cn-corrosion-resistant-steel', title: 'Corrosion-resistant steel (CN)', detail: 'AD on corrosion-resistant flat' },
  { slug: 'cn-bev-passenger-cars', title: 'BEV passenger cars (CN)', detail: 'Definitive CVD on BEV passenger cars' },
  { slug: 'cn-bicycles', title: 'Bicycles (CN)', detail: 'Active AD measure on conventional bicycles' },
  { slug: 'cn-bicycle-parts', title: 'Bicycle parts (CN)', detail: 'Active AD measure on certain components' },
  { slug: 'cn-ceramic-tableware', title: 'Ceramic tableware (CN)', detail: 'Active AD on dinnerware and kitchenware' },
  { slug: 'cn-ceramic-tiles', title: 'Ceramic tiles (CN)', detail: 'Active AD on porcelain and stoneware tiles' },
  { slug: 'cn-disposable-lighters', title: 'Disposable lighters (CN)', detail: 'Active AD measure on gas-fuelled lighters' },
  { slug: 'cn-citric-acid', title: 'Citric acid (CN)', detail: 'AD on industrial-grade citric acid' },
  { slug: 'cn-fatty-acid', title: 'Fatty acid (CN)', detail: 'Active AD measure on certain fatty acids' },
];

export default function TradeDefenceHubPage() {
  return (
    <>
      <EditorialHeader
        kicker="Trade defence"
        title="Active EU measures on Chinese commodities."
        lead="Anti-dumping and countervailing duties currently in force. Each entry links to the rate, the publication reference, the affected HS codes, and the carve-outs."
        meta="Updated when the OJEU publishes a new measure or expiry"
      />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp>
            <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2 lg:grid-cols-3 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
              {MEASURES.map((m) => (
                <Link
                  key={m.slug}
                  href={`/guides/trade-defence/${m.slug}/`}
                  className="group flex flex-col gap-3 bg-[var(--color-ink)] p-7 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-8"
                >
                  <span className="font-mono text-[11px] font-medium tabular-nums tracking-tight text-[var(--color-ivory-mute)]">
                    {m.slug}
                  </span>
                  <h3
                    className="font-serif text-[1.2rem] leading-[1.2] tracking-[-0.014em] text-[var(--color-ivory)]"
                    style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                  >
                    {m.title}
                  </h3>
                  <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
                    {m.detail}
                  </span>
                </Link>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
