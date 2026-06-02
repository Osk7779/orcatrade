import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Press kit — OrcaTrade Group',
  description:
    'Press kit, fact sheet, and contact for OrcaTrade Group — the AI-native trade-compliance + import-operations platform for European SMEs.',
};

const FACTS = [
  ['Operating entity', 'OrcaTrade Group Ltd · London · Warsaw · Hong Kong'],
  ['Founded', '2024'],
  ['Stage', 'Pre-seed / pre-revenue (2026)'],
  ['Coverage today', 'EU + UK customs, CBAM, EUDR, REACH, CE marking, anti-dumping & countervailing duties, FX, routing, warehousing, working capital, total cost of ownership'],
  ['Languages', 'EN · PL · DE — every public surface localised, including the 658 SEO guides'],
  ['Stack', 'Next.js 15 + React 19 · Vercel · Neon Postgres · Upstash Redis · Anthropic Claude · Resend · Stripe · Sentry'],
  ['Discipline', 'Calculator-grounded: every monetary, percentage, weight, or duty-rate figure comes from a deterministic calculator output. AI writes prose; numbers come from code.'],
];

const POSITIONING = [
  'OrcaTrade is the import operations team available 24/7 for European SMEs sourcing from Asia. The five-agent platform (compliance, sourcing, logistics, finance, orchestrator) is calculator-grounded — every euro is reproducible from inputs, every regulatory claim cites a verbatim chunk.',
  'The product covers the full workflow: HS-code classification, duty + VAT + brokerage math, anti-dumping + countervailing-duty exposure, CBAM certificates, EUDR Due Diligence Statements, REACH SVHC notifications, CE-marking responsibility transfer, routing across modes, bonded-warehouse cash-flow trade-offs, FX hedging, working-capital cycle, total cost of ownership — with a published audit chain and a public anchor that proves the chain has not been rewritten.',
  'Editorial stance: under-claim and be accurate over overstate and apologise. No fabricated metrics. Posture statements only.',
];

export default function PressPage() {
  return (
    <>
      <EditorialHeader
        kicker="Press kit"
        title={<>For journalists, analysts, and procurement teams writing about OrcaTrade.</>}
        lead="Fact sheet, positioning copy, and direct contact. All figures are honest current-state; we will not provide an attributed customer testimonial pre-revenue (2026)."
        meta="Last updated · current quarter · MMXXVI"
      />

      <ChapterRule numeral="I" label="Fact sheet" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[900px] px-6">
          <FadeUp>
            <dl className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-[200px_1fr]">
              {FACTS.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ivory-mute)]">
                    {k}
                  </dt>
                  <dd className="text-[14px] leading-[1.65] text-[var(--color-ivory-dim)]">{v}</dd>
                </div>
              ))}
            </dl>
          </FadeUp>
        </div>
      </section>

      <ChapterRule numeral="II" label="Positioning" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[760px] px-6">
          <FadeUp>
            <div className="space-y-5 text-[16px] leading-[1.7] text-[var(--color-ivory-dim)]">
              {POSITIONING.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      <ChapterRule numeral="III" label="Assets + contact" />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[760px] px-6">
          <FadeUp>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { name: 'Brand guidelines (PDF)', desc: 'Logo lockups, palette, type stack, do-not.', href: '#' },
                { name: 'Open Graph image', desc: '1200×630 share card, navy + ivory.', href: 'https://orcatrade.pl/og-1200x630.png' },
                { name: 'Founder photo', desc: 'On request via press contact.', href: 'mailto:press@orcatrade.pl' },
                { name: 'Logo (SVG, PNG)', desc: 'On request via press contact.', href: 'mailto:press@orcatrade.pl' },
              ].map((asset) => (
                <Link
                  key={asset.name}
                  href={asset.href}
                  target={asset.href.startsWith('http') ? '_blank' : undefined}
                  rel={asset.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-5 transition-colors hover:border-[var(--color-ivory)]/30"
                >
                  <div className="font-serif text-[16px] leading-[1.25] text-[var(--color-ivory)]">{asset.name}</div>
                  <div className="mt-2 text-[13px] leading-[1.55] text-[var(--color-ivory-dim)]">{asset.desc}</div>
                </Link>
              ))}
            </div>
            <div className="mt-12 border-t border-[var(--color-navy-line)] pt-10 text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
              <p>
                <strong className="text-[var(--color-ivory)]">Press contact:</strong>{' '}
                <a href="mailto:press@orcatrade.pl" className="text-[var(--color-ivory)] underline-offset-2 hover:underline">press@orcatrade.pl</a>
              </p>
              <p className="mt-2">
                <strong className="text-[var(--color-ivory)]">Security:</strong>{' '}
                <a href="mailto:security@orcatrade.pl" className="text-[var(--color-ivory)] underline-offset-2 hover:underline">security@orcatrade.pl</a> — see <Link href="/trust" className="text-[var(--color-ivory)] underline-offset-2 hover:underline">/trust</Link> for disclosure policy.
              </p>
              <p className="mt-2">
                <strong className="text-[var(--color-ivory)]">General:</strong>{' '}
                <Link href="/contact" className="text-[var(--color-ivory)] underline-offset-2 hover:underline">/contact</Link>
              </p>
            </div>
          </FadeUp>
        </div>
      </section>
    </>
  );
}
