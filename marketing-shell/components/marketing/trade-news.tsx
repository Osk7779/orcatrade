'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Marquee } from './marquee';
import { FadeUp } from './fade-up';
import { EN_COPY, type HomepageCopy } from '@/lib/i18n/homepage-copy';

// Real guide topics from the live OrcaTrade.pl /guides/compliance/ tree.
// Topic codes (CBAM, EUDR, REACH…) stay verbatim across locales; only
// the human-readable label is localized below from the source bundle.
const TICKER_TOPICS = [
  'CBAM',
  'EUDR',
  'REACH',
  'CE LVD/EMC/RED',
  'GPSR',
  'WEEE',
  'PPWR',
  'Cosmetics 1223/2009',
];
const TICKER_LABELS_EN = [
  'Carbon Border Adjustment Mechanism — definitive period',
  'EU Deforestation Regulation — due-diligence and the geolocation file',
  'REACH — SVHC, registration thresholds and authorisation',
  'CE marking for electrical equipment — low voltage, EMC, radio',
  'General Product Safety Regulation — EU responsible person required',
  'WEEE — producer registration and the take-back obligation',
  'Packaging and Packaging Waste Regulation — material thresholds',
  'Cosmetics Regulation — CPNP, Product Information File, Responsible Person',
];
const TICKER_LABELS_PL = [
  'Carbon Border Adjustment Mechanism — okres definitywny',
  'EU Deforestation Regulation — due diligence i plik geolokalizacji',
  'REACH — SVHC, progi rejestracji i autoryzacja',
  'Oznakowanie CE dla urządzeń elektrycznych — niskie napięcie, EMC, radio',
  'General Product Safety Regulation — wymagana osoba odpowiedzialna w UE',
  'WEEE — rejestracja producenta i obowiązek odbioru',
  'Packaging and Packaging Waste Regulation — progi materiałowe',
  'Rozporządzenie kosmetyczne — CPNP, Dokument Informacyjny, Osoba Odpowiedzialna',
];
const TICKER_LABELS_DE = [
  'Carbon Border Adjustment Mechanism — definitive Periode',
  'EU Deforestation Regulation — Sorgfaltspflicht und Geolokalisierungsdatei',
  'REACH — SVHC, Registrierungsschwellen und Zulassung',
  'CE-Kennzeichnung für elektrische Geräte — Niederspannung, EMV, Funk',
  'General Product Safety Regulation — EU-verantwortliche Person erforderlich',
  'WEEE — Herstellerregistrierung und Rücknahmepflicht',
  'Packaging and Packaging Waste Regulation — Material-Schwellenwerte',
  'Kosmetikverordnung — CPNP, Produktinformationsdatei, Verantwortliche Person',
];

const FEATURED_META = [
  { href: '/guides/compliance/cbam/', readMin: 9 },
  { href: '/guides/compliance/eudr/', readMin: 11 },
  { href: '/guides/compliance/gpsr/', readMin: 7 },
];

const TickerItem = ({ topic, label }: { topic: string; label: string }) => (
  <span className="flex shrink-0 items-center gap-4 text-[12px] text-[var(--color-ivory-dim)]">
    <span className="font-medium tracking-tight text-[var(--color-ivory-mute)]">{topic}</span>
    <span aria-hidden className="size-1 rounded-full bg-[var(--color-navy-line)]" />
    <span className="font-serif italic text-[var(--color-ivory)]">{label}</span>
  </span>
);

type NewsArticle = HomepageCopy['newsSection']['items'][number] & {
  href: string;
  readMin: number;
};

function NewsCard({
  article,
  minSuffix,
  readGuide,
}: {
  article: NewsArticle;
  minSuffix: string;
  readGuide: string;
}) {
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
          {article.readMin} {minSuffix}
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
            {readGuide}
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

export function TradeNews({
  copy = EN_COPY.newsSection,
  locale = 'en',
}: {
  copy?: HomepageCopy['newsSection'];
  locale?: 'en' | 'pl' | 'de';
}) {
  const labels =
    locale === 'pl' ? TICKER_LABELS_PL : locale === 'de' ? TICKER_LABELS_DE : TICKER_LABELS_EN;
  const ticker = TICKER_TOPICS.map((topic, i) => ({ topic, label: labels[i] }));
  const articles: NewsArticle[] = copy.items.map((item, i) => ({
    ...item,
    ...FEATURED_META[i],
  }));
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
            {copy.title}
          </h2>
          <Link
            href="/guides/compliance/"
            className="group inline-flex items-center gap-2 text-[12.5px] font-medium text-[var(--color-ivory)] transition-all duration-500"
          >
            <span className="relative">
              {copy.viewAll}
              <span className="absolute -bottom-0.5 left-0 h-px w-0 bg-[var(--color-ivory)]/70 transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-full" />
            </span>
            <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        </FadeUp>

        <div className="mb-16 border-y border-[var(--color-navy-line)] bg-[var(--color-ink)] py-5">
          <Marquee durationMs={70_000} pauseOnHover>
            {ticker.map((item) => (
              <TickerItem key={item.topic + item.label} topic={item.topic} label={item.label} />
            ))}
          </Marquee>
        </div>

        <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-3">
          {articles.map((article) => (
            <NewsCard
              key={article.href}
              article={article}
              minSuffix={copy.minSuffix}
              readGuide={copy.readGuide}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
