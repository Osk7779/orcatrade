import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';

export const metadata: Metadata = {
  title: 'Trust & security — OrcaTrade Group',
  description:
    'How the OrcaTrade platform handles your data, your money math, and the regulatory record.',
};

const SECTIONS = [
  {
    id: 'data-rights',
    numeral: 'I',
    title: 'Your data rights.',
    kicker: 'GDPR',
    body: [
      'We collect the minimum personal data required to run an account. Email is stored as a SHA-256 hash on the application side; the raw address is held only by the magic-link store and the email delivery provider.',
      'You can export everything we hold on you in one call, and you can delete it in one call. Deletion pseudonymises history rather than erasing it, so the audit trail remains verifiable — your identity is removed, the events are not.',
    ],
  },
  {
    id: 'auth',
    numeral: 'II',
    title: 'Authentication and access.',
    kicker: 'Magic-link auth',
    body: [
      'Sign-in is by single-use email link, signed and short-lived. No passwords to leak, lose or reuse. The session cookie is first-party, same-site, secure, and rotated on privilege escalation.',
      'Teams gate access by membership. Role changes are audit-logged. There are no shared accounts in production.',
    ],
  },
  {
    id: 'audit',
    numeral: 'III',
    title: 'Audit and accountability.',
    kicker: 'Hash-chained mutations',
    body: [
      'Every state change is hash-stamped over a GDPR-compatible projection. The chain is exportable in one call and independently verifiable end-to-end — including by a regulator, an auditor, or you.',
      'Because the projection excludes raw personal data, an erasure request never breaks the chain. The audit trail and the right to be forgotten coexist.',
    ],
  },
  {
    id: 'reproducibility',
    numeral: 'IV',
    title: 'Reproducibility of every euro.',
    kicker: 'Provenance',
    body: [
      'Every plan we generate is stamped with the calculator version, the data-snapshot date, and the customs mode used. You can reproduce any quote we wrote, on any date we wrote it.',
      'The LLM never produces a number that drives a decision. Calculators move money; the AI layer writes prose on top. The two are walled off in the codebase and enforced by CI.',
    ],
  },
  {
    id: 'transport',
    numeral: 'V',
    title: 'Application and transport security.',
    kicker: 'Defaults',
    body: [
      'HSTS, content-security-policy, X-Frame-Options, X-Content-Type-Options and a strict Referrer-Policy on every response. Subresource integrity on third-party scripts. Cookies SameSite=Strict where compatible.',
      'Inbound HTTP is TLS-only. Database connections are encrypted in transit. Secrets live in the platform key store; the application code never sees raw credentials.',
    ],
  },
  {
    id: 'disclosure',
    numeral: 'VI',
    title: 'Responsible disclosure.',
    kicker: 'security.txt',
    body: [
      'Found a vulnerability? Send the details to security@orcatradegroup.com. We acknowledge within one business day, triage within three, and credit the reporter when the fix lands.',
      'We will not pursue good-faith research that respects the disclosure timeline. There is no bug bounty programme today; if that changes, the terms will be published here first.',
    ],
  },
  {
    id: 'subprocessors',
    numeral: 'VII',
    title: 'Subprocessors.',
    kicker: 'Vendors',
    body: [
      'A short list, chosen for what they refuse to do as much as for what they do. Hosting and edge — Vercel. Database — Neon. Email — Resend. Analytics — Vercel Analytics, page-view counts only, opt-in. AI inference — Anthropic.',
      'No advertising or retargeting subprocessors. No behavioural tracking. The list is published on this page and updated when it changes.',
    ],
  },
  {
    id: 'reliability',
    numeral: 'VIII',
    title: 'Reliability.',
    kicker: 'Status',
    body: [
      'Health endpoint at /api/health publishes the live status of every subsystem the platform depends on — calculators, retrieval, sanctions lists, customs integration, audit chain.',
      'Public status page at /status with the same readout, refreshed on a short interval. Incidents are written up post-hoc, dated, and kept in the record permanently.',
    ],
  },
  {
    id: 'roadmap',
    numeral: 'IX',
    title: 'What we do not yet have.',
    kicker: 'On record',
    body: [
      'SOC 2 Type II — not yet certified. We will publish the audit window and outcome on this page when it begins. ISO 27001 — same. We will not claim certifications we have not earned.',
      'A formal penetration-test cadence — annual once we have completed our first paid year of operation. Reports will be available under NDA to enterprise customers on request.',
    ],
  },
];

export default function TrustPage() {
  return (
    <>
      <EditorialHeader
        kicker="Trust & security"
        title={
          <>
            How the platform handles your data,
            <br className="hidden md:block" /> your money math, and the record.
          </>
        }
        lead="Posture statements, not certificates. We publish what we do and how, including the things we have not earned yet. The document is updated when the practice changes, not when the marketing window opens."
        meta="Last reviewed · current quarter · MMXXVI"
      />

      {SECTIONS.map((s, i) => (
        <div key={s.id}>
          <ChapterRule numeral={s.numeral} label={s.title.replace(/\.$/, '')} />
          <section
            id={s.id}
            data-chapter={s.title.replace(/\.$/, '')}
            data-chapter-numeral={s.numeral}
            className={`bg-[var(--color-ink)] py-20 md:py-28 ${
              i < SECTIONS.length - 1 ? 'border-b border-[var(--color-navy-line)]' : ''
            }`}
          >
            <div className="mx-auto max-w-[860px] px-6">
              <FadeUp>
                <div className="flex items-center gap-3">
                  <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/55">
                    ❦
                  </span>
                  <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                    {s.kicker}
                  </span>
                </div>
                <h2
                  className="mt-5 font-serif text-[clamp(1.8rem,2.8vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
                  style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
                >
                  {s.title}
                </h2>
                <div className="mt-7 flex flex-col gap-5 max-w-[62ch]">
                  {s.body.map((p, j) => (
                    <p key={j} className="text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
                      {p}
                    </p>
                  ))}
                </div>
              </FadeUp>
            </div>
          </section>
        </div>
      ))}
    </>
  );
}
