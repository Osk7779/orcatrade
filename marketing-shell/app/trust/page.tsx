import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { ChapterRule } from '@/components/marketing/chapter-rule';
import { FadeUp } from '@/components/marketing/fade-up';
import { CertificationsTable, type CertRow } from '@/components/marketing/certifications-table';
import { DocumentsGrid, type DocItem } from '@/components/marketing/documents-grid';
import { AuditAnchorWidget } from '@/components/marketing/audit-anchor-widget';

export const metadata: Metadata = {
  title: 'Trust & security — OrcaTrade Group',
  description:
    'How the OrcaTrade platform handles your data, your money math, and the regulatory record.',
};

// Sections that are pure editorial copy (no tabular content + no live
// widget). Each renders as a ChapterRule + FadeUp + body paragraphs.
// Sections that need a richer layout (certifications, documents, AI
// use, audit anchor live, reproducibility with TARIC) live below as
// dedicated blocks.
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
      'A public anchor is published at /api/audit-anchor — no auth, no PII, just the sha256 head and length. Fetch it on a schedule and store each receipt locally; a later fetch whose chain does not pass through your earlier head is third-party-detectable evidence of a rewrite.',
    ],
  },
];

const SECTIONS_LATE = [
  {
    id: 'transport',
    numeral: 'VI',
    title: 'Application and transport security.',
    kicker: 'Defaults',
    body: [
      'HSTS, content-security-policy, X-Frame-Options, X-Content-Type-Options and a strict Referrer-Policy on every response. Subresource integrity on third-party scripts. Cookies SameSite=Strict where compatible.',
      'Inbound HTTP is TLS-only. Database connections are encrypted in transit. Secrets live in the platform key store; the application code never sees raw credentials.',
    ],
  },
  {
    id: 'disclosure',
    numeral: 'VII',
    title: 'Responsible disclosure.',
    kicker: 'security.txt',
    body: [
      'Found a vulnerability? Send the details to security@orcatradegroup.com. We acknowledge within one business day, triage within three, and credit the reporter when the fix lands.',
      'We will not pursue good-faith research that respects the disclosure timeline. There is no bug bounty programme today; if that changes, the terms will be published here first.',
    ],
  },
  {
    id: 'subprocessors',
    numeral: 'VIII',
    title: 'Subprocessors.',
    kicker: 'Vendors',
    body: [
      'A short list, chosen for what they refuse to do as much as for what they do. Hosting and edge — Vercel. Database — Neon. Email — Resend. Analytics — Vercel Analytics, page-view counts only, opt-in. AI inference — Anthropic.',
      'No advertising or retargeting subprocessors. No behavioural tracking. The list is published on this page and updated when it changes.',
    ],
  },
  {
    id: 'reliability',
    numeral: 'IX',
    title: 'Reliability.',
    kicker: 'Status',
    body: [
      'Health endpoint at /api/health publishes the live status of every subsystem the platform depends on — calculators, retrieval, sanctions lists, customs integration, audit chain.',
      'Public status page at /status with the same readout, refreshed on a short interval. Incidents are written up post-hoc, dated, and kept in the record permanently.',
    ],
  },
];

const CERT_ROWS: CertRow[] = [
  { standard: 'GDPR — data-subject tooling, audit log, retention enforcement', status: 'live' },
  { standard: 'UK ICO data-protection registration', status: 'queued', target: 'Before first paying customer' },
  { standard: 'EU AI Act — Limited Risk transparency (Art. 50)', status: 'live' },
  { standard: 'SOC 2 Type I — scoping', status: 'ready', target: 'Phase 2 (post-seed)' },
  { standard: 'SOC 2 Type II', status: 'queued', target: 'Post Type I + 6 months evidence' },
  { standard: 'ISO 27001', status: 'queued', target: 'Phase 3' },
  { standard: 'ISO 27701 (privacy ISMS extension)', status: 'queued', target: 'Phase 3 (paired with 27001)' },
  { standard: 'Third-party penetration test', status: 'ready', target: 'Scope brief published' },
];

const DOC_ITEMS: DocItem[] = [
  { name: 'SECURITY.md', description: 'Vulnerability-disclosure policy, response SLAs, scope, no-legal-action promise', href: 'https://github.com/Osk7779/orcatrade/blob/main/SECURITY.md' },
  { name: 'data-flow.md', description: 'Every personal datum, where it lives, how each GDPR right maps to an endpoint', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/data-flow.md' },
  { name: 'retention-policy.md', description: 'Per-table retention periods + nightly programmatic purge + verification job', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/retention-policy.md' },
  { name: 'audit-trail.md', description: 'Tamper-evident hash chain + independent verification procedure', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/audit-trail.md' },
  { name: 'subprocessors.md', description: 'Full third-party processor list with DPA links + transfer mechanisms', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/subprocessors.md' },
  { name: 'vendor-tprm.md', description: '12-question security questionnaire answered per subprocessor', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/vendor-tprm.md' },
  { name: 'dpa-template.md', description: 'Article 28 Data Processing Agreement + Annex A (technical & organisational measures)', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/dpa-template.md' },
  { name: 'soc2-readiness.md', description: 'Honest gap analysis against AICPA TSC — what is in, what is queued, what we are not', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/soc2-readiness.md' },
  { name: 'incident-response.md', description: 'Severity classes, runbooks, breach-notification SLAs, post-mortem cadence', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/incident-response.md' },
  { name: 'threat-models/', description: 'STRIDE walk-throughs for AI agent + customer API + magic-link auth — with gaps listed', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/threat-models/' },
  { name: 'pentest-scope.md', description: 'Engagement scope OrcaTrade hands to a pen-test vendor — RoE + cost estimate', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/security/pentest-scope.md' },
  { name: 'AI model cards', description: 'Per-agent intended use / scope / evaluations / limits / oversight', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/ai/model-cards/README.md' },
  { name: 'EU AI Act conformance', description: 'Published Limited-Risk classification + Art. 50 transparency evidence', href: 'https://github.com/Osk7779/orcatrade/blob/main/docs/ai/eu-ai-act-conformance.md' },
  { name: 'CONTRIBUTING.md', description: 'Engineering norms, hard rules, what requires a PR review', href: 'https://github.com/Osk7779/orcatrade/blob/main/CONTRIBUTING.md' },
];

function EditorialSection({
  id,
  numeral,
  title,
  kicker,
  body,
  children,
}: {
  id: string;
  numeral: string;
  title: string;
  kicker: string;
  body?: string[];
  children?: React.ReactNode;
}) {
  return (
    <>
      <ChapterRule numeral={numeral} label={title.replace(/\.$/, '')} />
      <section
        id={id}
        data-chapter={title.replace(/\.$/, '')}
        data-chapter-numeral={numeral}
        className="border-b border-[var(--color-navy-line)] bg-[var(--color-ink)] py-20 last:border-b-0 md:py-28"
      >
        <div className="mx-auto max-w-[860px] px-6">
          <FadeUp>
            <div className="flex items-center gap-3">
              <span aria-hidden className="font-serif text-[13px] text-[var(--color-ivory-dim)]/55">
                ❦
              </span>
              <span className="font-serif text-[13px] italic text-[var(--color-ivory-mute)]">
                {kicker}
              </span>
            </div>
            <h2
              className="mt-5 font-serif text-[clamp(1.8rem,2.8vw+0.4rem,2.4rem)] leading-[1.1] tracking-[-0.02em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
            >
              {title}
            </h2>
            {body && body.length > 0 && (
              <div className="mt-7 flex max-w-[62ch] flex-col gap-5">
                {body.map((p, j) => (
                  <p key={j} className="text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
                    {p}
                  </p>
                ))}
              </div>
            )}
            {children && <div className="mt-8">{children}</div>}
          </FadeUp>
        </div>
      </section>
    </>
  );
}

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

      {/* I — Data rights */}
      {/* II — Auth */}
      {/* III — Audit (includes public anchor reference) */}
      {SECTIONS.map((s) => (
        <EditorialSection key={s.id} {...s} />
      ))}

      {/* IV — Reproducibility, with TARIC pinning + live anchor widget */}
      <EditorialSection
        id="reproducibility"
        numeral="IV"
        title="Reproducibility of every euro."
        kicker="Provenance"
        body={[
          'Every plan we generate is stamped with the calculator version, the data-snapshot date, and — as of 2026-06-02 — the per-quote TARIC duty rate pinned with its source and asOf timestamp. You can reproduce any quote we wrote, on any date we wrote it.',
          'The LLM never produces a number that drives a decision. Calculators move money; the AI layer writes prose on top. The two are walled off in the codebase and enforced by CI.',
          'Recompute a saved plan and the verdict tells you, plainly, whether today’s market data still produces the same euros — and when it doesn’t, it itemises which values moved (FX rate, AD/CVD rate, ETS price, TARIC duty rate) and shows the original landed total side-by-side with today’s.',
        ]}
      >
        <AuditAnchorWidget />
      </EditorialSection>

      {/* V — AI use */}
      <EditorialSection
        id="ai"
        numeral="V"
        title="AI use."
        kicker="Limited Risk (EU AI Act Art. 50)"
        body={[
          'OrcaTrade deploys five AI agents — compliance, sourcing, logistics, finance, and an orchestrator that merges their tools. Each carries a published model card covering intended use, out-of-scope use, model and provider, inputs and outputs, calculator-grounding contract, evaluations, known limitations and human oversight.',
        ]}
      >
        <ul className="grid gap-4 md:grid-cols-2">
          {[
            ['No decision-driving numbers from the LLM.', 'Every monetary, percentage, weight or duty-rate figure comes from a deterministic calculator output. Two eval gates enforce it: checkGrounding catches fabrication; checkNumericFidelity catches omission.'],
            ['EU AI Act Limited Risk (Art. 50 transparency).', 'Full position published — covering Art. 50 transparency, voluntary Art. 14 oversight, no high-risk Annex III activity.'],
            ['No training on customer data.', 'Anthropic does not train on API traffic. We do not fine-tune. We do not train any models ourselves.'],
            ['Human-in-the-loop on irreversible action.', 'Customs filings, CBAM surrenders, EUDR DDS submissions and signed supplier contracts all route through requestHumanReview first. The platform never files.'],
            ['Per-tenant spend cap.', 'Hard EUR/month limit per tier — free €1, starter €15, growth €100, scale €500. Runaway behaviour surfaces before billing.'],
            ['Threat models published.', 'STRIDE walk-throughs for the AI agent surface, the customer API, and magic-link auth — with residual risk listed honestly.'],
          ].map(([title, desc], i) => (
            <li
              key={title}
              className="border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-4 transition-colors hover:border-[var(--color-ivory)]/35"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="font-serif text-[15px] leading-[1.35] text-[var(--color-ivory)]">
                {title}
              </div>
              <div className="mt-2 text-[13px] leading-[1.6] text-[var(--color-ivory-dim)]">
                {desc}
              </div>
            </li>
          ))}
        </ul>
      </EditorialSection>

      {/* VI–IX — Transport, disclosure, subprocessors, reliability */}
      {SECTIONS_LATE.map((s) => (
        <EditorialSection key={s.id} {...s} />
      ))}

      {/* X — Certifications & roadmap (honest table) */}
      <EditorialSection
        id="certifications"
        numeral="X"
        title="Certifications & compliance roadmap."
        kicker="On record"
        body={[
          'Being straight about where we are: we are not yet certified against SOC 2 or ISO 27001, and we will not claim a certification we do not hold. Roadmap below — Live means evidence is in the repository today; Ready means scoping is complete and engagement is queued; Queued means planned without a commitment date.',
        ]}
      >
        <CertificationsTable rows={CERT_ROWS} />
      </EditorialSection>

      {/* XI — Documents we publish */}
      <EditorialSection
        id="documents"
        numeral="XI"
        title="Documents we publish."
        kicker="Source of truth"
        body={[
          'Every load-bearing security or compliance claim on this page is backed by a versioned document in the repository. Each document carries a Last updated date and a revision history. Read the underlying claim, not the marketing.',
        ]}
      >
        <DocumentsGrid items={DOC_ITEMS} />
      </EditorialSection>
    </>
  );
}
