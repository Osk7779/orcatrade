import type { Metadata } from 'next';
import Link from 'next/link';
import { Aurora } from '@/components/marketing/aurora';
import { AmbientParticles } from '@/components/marketing/ambient-particles';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { CursorSpotlight } from '@/components/marketing/cursor-spotlight';
import { FadeUp } from '@/components/marketing/fade-up';
import { HubCard } from '@/components/marketing/hub-card';
import { Marquee } from '@/components/marketing/marquee';
import { NumberTicker } from '@/components/marketing/number-ticker';
import { SparklesText } from '@/components/marketing/sparkles';

export const metadata: Metadata = {
  title: 'Guides — OrcaTrade Group',
  description:
    'Calculator-grounded reference for Asia–Europe trade. Sourcing, routing, customs, warehousing, compliance, preferential origin, trade defence.',
};

const HUBS = [
  {
    href: '/guides/sourcing',
    kicker: 'Stage 02 — Source it',
    title: 'Sourcing.',
    description:
      'Eight Asia origins, six commodity categories. What to ask suppliers, what to verify before the deposit, what to avoid.',
    detail: 'Apparel · cosmetics · electronics · footwear · furniture · homeware · machinery · toys',
  },
  {
    href: '/guides/customs',
    kicker: 'Stage 03 — Clear it',
    title: 'Customs.',
    description:
      'EU and UK customs procedures by commodity and destination. Duty, VAT, anti-dumping, CVD, CBAM — what hits at the port.',
    detail: 'Six commodity classes · six destinations · live TARIC',
  },
  {
    href: '/guides/compliance',
    kicker: 'Stage 03 — Verify it',
    title: 'Compliance regimes.',
    description:
      'Every EU regulatory regime that touches consumer and industrial imports. CBAM, EUDR, REACH, CE, GPSR and twelve more.',
    detail: '13 regimes · cited, summarised, kept current',
  },
  {
    href: '/guides/preferential-origin',
    kicker: 'Across the lanes',
    title: 'Preferential origin.',
    description:
      'EBA, EU–Korea FTA, EVFTA, GSP, GSP+, A.TR Customs Union, EU–Japan EPA. Where the duty drops and where it does not.',
    detail: '7 frameworks · 7 origins',
  },
  {
    href: '/guides/trade-defence',
    kicker: 'When duty stacks',
    title: 'Trade defence.',
    description:
      'Anti-dumping and countervailing duties currently in force on Chinese commodities. The rates, the chapters, the carve-outs.',
    detail: '45 measures · monitored quarterly',
  },
  {
    href: '/guides/routing',
    kicker: 'Stage 04 — Move it',
    title: 'Routing.',
    description:
      'Sea, rail, air — by lane, by season, by cost-priority. Door-to-door benchmarks, transit-time bands, carrier mix per route.',
    detail: 'CN/VN/IN/BD/TR origins · DE/NL/PL/ES/IT/FR destinations',
  },
  {
    href: '/guides/warehouse',
    kicker: 'Stage 05 — Hold it',
    title: 'Warehouse.',
    description:
      'Six EU 3PL hubs benchmarked. Storage cost, pick & pack, bonded vs free-circulation, monthly cost for typical SME shipper.',
    detail: 'Rotterdam · Hamburg · Frankfurt · Poznań · Prague · Barcelona',
  },
];

const STATS = [
  { value: 658, label: 'Pages published' },
  { value: 13, label: 'Compliance regimes' },
  { value: 45, label: 'AD/CVD measures' },
  { value: 3, label: 'Languages · EN/PL/DE' },
];

const TOPICS = [
  { tag: 'CBAM', label: 'Carbon Border Adjustment Mechanism — definitive period' },
  { tag: 'EUDR', label: 'EU Deforestation Regulation — due diligence + geolocation file' },
  { tag: 'REACH', label: 'REACH — SVHC, registration thresholds, authorisation' },
  { tag: 'CE LVD/EMC/RED', label: 'CE marking for electrical equipment' },
  { tag: 'GPSR', label: 'General Product Safety Regulation — EU responsible person' },
  { tag: 'WEEE', label: 'WEEE — producer registration + take-back' },
  { tag: 'PPWR', label: 'Packaging + Packaging Waste Regulation — material thresholds' },
  { tag: 'EBA', label: 'Everything But Arms — duty-free origin from least-developed countries' },
  { tag: 'EVFTA', label: 'EU–Vietnam FTA — REX origin · 0% duty' },
  { tag: 'EU AI Act', label: 'EU Artificial Intelligence Act — risk-class taxonomy' },
];

export default function GuidesHubPage() {
  return (
    <>
      {/* ── HERO: Aurora + sparkles + live editorial title ── */}
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] pt-20 pb-12 md:pt-28 md:pb-14">
        <Aurora />
        <AmbientParticles />
        <div className="relative mx-auto max-w-[1280px] px-6">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
            <span aria-hidden className="h-px w-8 bg-[var(--color-ivory-mute)]/40" />
            The reference library · seven hubs · free to read
          </div>
          <h1
            className="mt-7 max-w-[26ch] font-serif text-[clamp(2.4rem,4.2vw+0.4rem,4.2rem)] leading-[1.04] tracking-[-0.024em] text-[var(--color-ivory)]"
            style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
          >
            Calculator-grounded guides{' '}
            <SparklesText count={5}>for Asia–Europe trade.</SparklesText>
          </h1>
          <p className="mt-7 max-w-[62ch] text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
            Seven category hubs. Hundreds of pages, written against the same
            regulatory corpus the calculators consult — citation-checked, kept
            current, free to read without an account.
          </p>
          <div className="mt-8 flex items-center gap-3.5">
            <span className="h-px w-8 bg-[var(--color-ivory-mute)]/40" />
            <span aria-hidden className="font-serif text-[14px] text-[var(--color-ivory-dim)]/60">
              ❦
            </span>
            <span className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
              No paywall · no email gate · no behavioural tracking
            </span>
          </div>
        </div>
      </section>

      {/* ── LIVE STATS STRIP ─────────────────────────── */}
      <section className="border-y border-[var(--color-navy-line)] bg-[var(--color-ink)] py-10">
        <div className="mx-auto max-w-[1280px] grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-navy-line)] border-x border-[var(--color-navy-line)]">
          {STATS.map((s) => (
            <div key={s.label} className="bg-[var(--color-ink)] px-6 py-7 text-center">
              <div
                className="font-serif text-[clamp(2rem,3vw+0.4rem,2.6rem)] leading-none tracking-[-0.022em] text-[var(--color-ivory)]"
                style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 600 }}
              >
                <NumberTicker value={s.value} />
              </div>
              <div className="mt-2 font-mono text-[10.5px] tracking-[0.16em] uppercase text-[var(--color-ivory-mute)]">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── TOPIC MARQUEE ─────────────────────────────── */}
      <section className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-5">
        <div className="mb-3 text-center">
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-[var(--color-ivory-mute)]">
            Topics in the library
          </span>
        </div>
        <Marquee durationMs={55_000} pauseOnHover>
          {TOPICS.map((t) => (
            <span key={t.tag} className="flex shrink-0 items-center gap-3 text-[12.5px]">
              <span className="font-mono font-medium text-[var(--color-ivory)]">{t.tag}</span>
              <span aria-hidden className="text-[var(--color-navy-line)]">·</span>
              <span className="font-serif italic text-[var(--color-ivory-dim)]">{t.label}</span>
            </span>
          ))}
        </Marquee>
      </section>

      {/* ── HUB GRID ─────────────────────────────────── */}
      <ChapterRule numeral="I" label="Seven category hubs" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1280px] px-6">
          <FadeUp>
            <div className="grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] md:grid-cols-2 lg:grid-cols-3 [&>*]:transition-opacity [&>*]:duration-700 [&:has(>*:hover)>*:not(:hover)]:opacity-45">
              {HUBS.map((h) => (
                <HubCard key={h.href} {...h} />
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── FEATURED COMPLIANCE GUIDES ─────────────── */}
      <ChapterRule numeral="II" label="Most-read compliance guides" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[1280px] px-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[
              { href: '/guides/compliance/cbam/', tag: 'CBAM', title: 'Definitive period from January 2026.', body: 'Registration, embedded-emissions declarations, certificate purchase for steel, cement, aluminium, fertilisers, electricity and hydrogen.' },
              { href: '/guides/compliance/eudr/', tag: 'EUDR', title: 'Due diligence + geolocation file.', body: 'Soy, palm oil, cattle, coffee, cocoa, rubber, wood. Importers file DDS with plot-level geolocations.' },
              { href: '/guides/compliance/gpsr/', tag: 'GPSR', title: 'EU responsible person required.', body: 'Effective 13 December 2024 for consumer products. Non-EU sellers must appoint an EU economic operator.' },
              { href: '/guides/compliance/reach/', tag: 'REACH', title: 'SVHC, registration, authorisation.', body: 'Annual tonnage triggers registration. SVHC list updates twice yearly. Authorisation Annex XIV is the slow squeeze.' },
              { href: '/guides/compliance/ce-lvd-emc-red/', tag: 'CE LVD/EMC/RED', title: 'CE marking for electrical equipment.', body: 'Low voltage, electromagnetic compatibility, radio equipment. The three directives that hit anything with a plug or an antenna.' },
              { href: '/guides/compliance/ppwr/', tag: 'PPWR', title: 'Packaging + Packaging Waste Regulation.', body: 'Material thresholds, mandatory recycled content, EPR registration in every member state where you sell.' },
            ].map((g, i) => (
              <FadeUp key={g.href} delay={i * 0.05}>
                <CursorSpotlight className="h-full">
                  <Link
                    href={g.href}
                    className="group block h-full border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/25 p-6 transition-colors duration-500 hover:bg-[var(--color-navy-soft)] hover:border-[var(--color-ivory)]/25"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10.5px] tracking-[0.14em] uppercase text-[var(--color-ivory-mute)]">
                        {g.tag}
                      </span>
                      <span aria-hidden className="font-mono text-[14px] text-[var(--color-ivory-mute)] transition-transform duration-500 group-hover:translate-x-0.5">
                        →
                      </span>
                    </div>
                    <h3
                      className="mt-4 font-serif text-[1.2rem] leading-[1.2] tracking-[-0.014em] text-[var(--color-ivory)]"
                      style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                    >
                      {g.title}
                    </h3>
                    <p className="mt-3 text-[13.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
                      {g.body}
                    </p>
                  </Link>
                </CursorSpotlight>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLOSER ──────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-[var(--color-ink)] py-20 md:py-28">
        <Aurora />
        <div className="relative mx-auto max-w-[760px] px-6 text-center">
          <FadeUp>
            <span className="font-serif text-[14px] italic text-[var(--color-ivory-dim)]">
              Ready to apply the library
            </span>
            <h2
              className="mx-auto mt-6 max-w-[22ch] font-serif text-[clamp(1.8rem,2.8vw+0.4rem,2.6rem)] leading-[1.15] tracking-[-0.022em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              Open the wizard. Compose your plan.
            </h2>
            <p className="mt-6 text-[15.5px] leading-[1.78] text-[var(--color-ivory-dim)]">
              Every guide here is the prose layer over a calculator. The wizard
              calls those calculators on your lane and returns the plan.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Link
                href="/start"
                className="group inline-flex items-center gap-2 bg-[var(--color-ivory)] px-7 py-3.5 text-[12.5px] font-semibold text-[var(--color-ink)] hover:bg-white transition-colors duration-300"
              >
                Build my import plan
                <span aria-hidden className="transition-transform duration-500 group-hover:translate-x-0.5">→</span>
              </Link>
              <Link
                href="/intelligence"
                className="inline-flex items-center gap-2 border border-[var(--color-navy-line)] px-7 py-3.5 text-[12.5px] font-medium text-[var(--color-ivory)] hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)] transition-all duration-300"
              >
                Open Intelligence
              </Link>
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
