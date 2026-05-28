'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Marquee } from './marquee';
import { FadeUp } from './fade-up';

// Real guide topics from the live OrcaTrade.pl /guides/compliance/ tree.
// Nothing fabricated — every link resolves to an actual published guide.
const TICKER = [
  { topic: 'CBAM', label: 'Carbon Border Adjustment Mechanism — definitive period' },
  { topic: 'EUDR', label: 'EU Deforestation Regulation — due-diligence and the geolocation file' },
  { topic: 'REACH', label: 'REACH — SVHC, registration thresholds and authorisation' },
  { topic: 'CE LVD/EMC/RED', label: 'CE marking for electrical equipment — low voltage, EMC, radio' },
  { topic: 'GPSR', label: 'General Product Safety Regulation — EU responsible person required' },
  { topic: 'WEEE', label: 'WEEE — producer registration and the take-back obligation' },
  { topic: 'PPWR', label: 'Packaging and Packaging Waste Regulation — material thresholds' },
  { topic: 'Cosmetics 1223/2009', label: 'Cosmetics Regulation — CPNP, Product Information File, Responsible Person' },
];

const FEATURED = [
  {
    href: '/guides/compliance/cbam/',
    tag: 'Compliance · CBAM',
    regime: 'Carbon Border Adjustment Mechanism',
    title: 'CBAM — what changes in the definitive period.',
    excerpt:
      'Reporting closes 31 December 2025. From January 2026 financial obligations begin: registration, embedded-emissions declarations, and CBAM certificate purchase for steel, cement, aluminium, fertilisers, electricity and hydrogen.',
    readMin: 9,
  },
  {
    href: '/guides/compliance/eudr/',
    tag: 'Compliance · EUDR',
    regime: 'EU Deforestation Regulation',
    title: 'EUDR — due diligence statements and the geolocation file.',
    excerpt:
      'Soy, palm oil, cattle, coffee, cocoa, rubber, wood — and many derived products. Importers file due-diligence statements with plot-level geolocations. Includes textiles in the next rollout window.',
    readMin: 11,
  },
  {
    href: '/guides/compliance/gpsr/',
    tag: 'Compliance · GPSR',
    regime: 'General Product Safety Regulation',
    title: 'GPSR — why every non-EU seller now needs an EU responsible person.',
    excerpt:
      'Effective 13 December 2024 for consumer products. Article 4 forces non-EU sellers to appoint an EU-established economic operator before placing goods on the market.',
    readMin: 7,
  },
];

const TickerItem = ({ topic, label }: { topic: string; label: string }) => (
  <span className="flex shrink-0 items-center gap-4 text-[12px] text-[var(--color-ivory-dim)]">
    <span className="font-medium tracking-tight text-[var(--color-ivory-mute)]">{topic}</span>
    <span aria-hidden className="size-1 rounded-full bg-[var(--color-navy-line)]" />
    <span className="font-serif italic text-[var(--color-ivory)]">{label}</span>
  </span>
);

function NewsCard({ article }: { article: (typeof FEATURED)[number] }) {
  const [spot, setSpot] = useState({ x: 0, y: 0, visible: false });

  return (
    <Link
      href={article.href}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setSpot({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          visible: true,
        });
      }}
      onMouseLeave={() => setSpot((p) => ({ ...p, visible: false }))}
      className="group relative isolate flex flex-col gap-5 overflow-hidden bg-[var(--color-ink)] p-9 transition-colors duration-700 hover:bg-[var(--color-navy-soft)] md:p-10"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] transition-opacity duration-700 ease-out"
        style={{
          opacity: spot.visible ? 1 : 0,
          background: `radial-gradient(320px circle at ${spot.x}px ${spot.y}px, rgba(250, 250, 247, 0.055), transparent 72%)`,
        }}
      />

      <div className="relative z-[2] flex items-center justify-between">
        <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
          {article.tag}
        </span>
        <span className="text-[10.5px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
          {article.readMin} min
        </span>
      </div>

      <h3
        className="relative z-[2] font-serif text-[1.35rem] leading-[1.25] tracking-[-0.014em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        {article.title}
      </h3>

      <p className="relative z-[2] line-clamp-4 max-w-[40ch] text-[14px] leading-[1.6] text-[var(--color-ivory-dim)]">
        {article.excerpt}
      </p>

      <div className="relative z-[2] mt-auto flex items-center justify-between pt-5">
        <span className="text-[11px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
          {article.regime}
        </span>
        <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-[var(--color-ivory)]">
          <span className="relative">
            Read the guide
            <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/70 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
          </span>
          <span
            aria-hidden
            className="transition-transform duration-500 group-hover:translate-x-0.5"
          >
            →
          </span>
        </span>
      </div>
    </Link>
  );
}

export function TradeNews() {
  return (
    <section
      id="news"
      className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 md:py-32"
    >
      <div className="mx-auto max-w-[1280px] px-6">
        <FadeUp className="mb-14 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
          <h2
            className="max-w-[32ch] font-serif text-[clamp(2.2rem,3.8vw+0.4rem,3.4rem)] leading-[1.08] tracking-[-0.022em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144" }}
          >
            From the desk &mdash; the reference library.
          </h2>
          <Link
            href="/guides/compliance/"
            className="group inline-flex items-center gap-2 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500"
          >
            <span className="relative">
              All compliance guides
              <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/70 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
            </span>
            <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        </FadeUp>

        <div className="mb-16 border-y border-[var(--color-navy-line)] bg-[var(--color-ink)] py-5">
          <Marquee durationMs={70_000} pauseOnHover>
            {TICKER.map((item) => (
              <TickerItem key={item.topic + item.label} topic={item.topic} label={item.label} />
            ))}
          </Marquee>
        </div>

        <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-3">
          {FEATURED.map((article) => (
            <NewsCard key={article.href} article={article} />
          ))}
        </div>
      </div>
    </section>
  );
}
