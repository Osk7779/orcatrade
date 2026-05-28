import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { HubCard } from '@/components/marketing/hub-card';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Preferential origin — OrcaTrade Group',
  description:
    'EBA, EU–Korea FTA, EVFTA, GSP and GSP+, A.TR Customs Union, EU–Japan EPA. Where the duty drops.',
};

const FRAMEWORKS = [
  {
    href: '/guides/preferential-origin/eba/',
    kicker: 'Everything But Arms',
    title: 'EBA — zero duty for LDC origins.',
    description:
      'Duty-free, quota-free access for least-developed countries. Bangladesh continues on the transitional schedule until 2029.',
  },
  {
    href: '/guides/preferential-origin/evfta/',
    kicker: 'EU–Vietnam FTA',
    title: 'EVFTA — Vietnam.',
    description:
      'Zero duty with a REX origin declaration on the invoice. Chapter 85 still triggers RoHS, WEEE and CE.',
  },
  {
    href: '/guides/preferential-origin/eukfta/',
    kicker: 'EU–Korea FTA',
    title: 'EUKFTA — South Korea.',
    description:
      'Zero duty on industrial goods. Origin declaration on the invoice; CE for machinery and electronics still applies.',
  },
  {
    href: '/guides/preferential-origin/eujepa/',
    kicker: 'EU–Japan EPA',
    title: 'EU–Japan EPA.',
    description:
      'Phased duty elimination on most chapters. Self-certification by the exporter; the importer claims preference at entry.',
  },
  {
    href: '/guides/preferential-origin/atr/',
    kicker: 'EU–Türkiye Customs Union',
    title: 'A.TR — Türkiye.',
    description:
      'Free circulation of industrial goods. Trade defence (anti-dumping, CVD) overrides preference — see /guides/trade-defence.',
  },
  {
    href: '/guides/preferential-origin/gsp-standard/',
    kicker: 'Generalised Scheme of Preferences',
    title: 'GSP — standard.',
    description:
      'Reduced or zero duty for developing countries. Sensitive product lists; sector graduation rules; documentation requirements.',
  },
  {
    href: '/guides/preferential-origin/gsp-plus/',
    kicker: 'GSP+',
    title: 'GSP+.',
    description:
      'Zero duty on most products for countries ratifying the twenty-seven conventions on human rights, labour, environment and governance.',
  },
];

const ORIGINS = [
  { slug: 'from-bd', name: 'From Bangladesh' },
  { slug: 'from-in', name: 'From India' },
  { slug: 'from-jp', name: 'From Japan' },
  { slug: 'from-kr', name: 'From South Korea' },
  { slug: 'from-pk', name: 'From Pakistan' },
  { slug: 'from-tr', name: 'From Türkiye' },
  { slug: 'from-vn', name: 'From Vietnam' },
];

export default function PreferentialOriginHubPage() {
  return (
    <>
      <EditorialHeader
        kicker="Preferential origin"
        title="Where the duty drops and where it does not."
        lead="Seven framework agreements and seven origin lookups. Each guide explains the qualifying rule, the documentation, and the trade-defence carve-outs that override preference."
        meta="7 frameworks · 7 origin lookups"
      />

      <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp className="mb-8 flex items-center gap-4">
            <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/60">
              ❦
            </span>
            <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
              By framework
            </span>
          </FadeUp>
          <FadeUp delay={0.05}>
            <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2 lg:grid-cols-3 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
              {FRAMEWORKS.map((f) => (
                <HubCard key={f.href} {...f} />
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp className="mb-8 flex items-center gap-4">
            <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/60">
              ❦
            </span>
            <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
              By origin
            </span>
          </FadeUp>
          <FadeUp delay={0.05}>
            <div className="grid grid-cols-2 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-4 lg:grid-cols-7">
              {ORIGINS.map((o) => (
                <a
                  key={o.slug}
                  href={`/guides/preferential-origin/${o.slug}/`}
                  className="group flex flex-col gap-1 bg-[var(--color-ink)] p-5 transition-colors duration-300 hover:bg-[var(--color-navy-soft)]"
                >
                  <span className="font-mono text-[11px] font-medium uppercase tabular-nums tracking-tight text-[var(--color-ivory)]">
                    {o.slug.replace('from-', '').toUpperCase()}
                  </span>
                  <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
                    {o.name}
                  </span>
                </a>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
