import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { LongForm, type LongFormSection } from '@/components/marketing/long-form';

export const metadata: Metadata = {
  title: 'Privacy policy — OrcaTrade Group',
  description:
    'How OrcaTrade Group Ltd handles personal data. UK GDPR and EU GDPR controller statement.',
};

const SECTIONS: LongFormSection[] = [
  {
    numeral: 'I',
    title: 'Who we are.',
    body: (
      <>
        <p>
          OrcaTrade Group Ltd (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) operates the
          trade-compliance and import-operations platform at orcatrade.pl and
          orcatradegroup.com. For the personal data described here, OrcaTrade
          Group Ltd is the data controller.
        </p>
        <p>
          You can reach us about privacy at{' '}
          <a
            href="mailto:privacy@orcatradegroup.com"
            className="text-[var(--color-ivory)] underline-offset-4 hover:underline"
          >
            privacy@orcatradegroup.com
          </a>
          .
        </p>
      </>
    ),
  },
  {
    numeral: 'II',
    title: 'What data we collect.',
    body: (
      <>
        <p>We collect the minimum personal data required to run an account:</p>
        <ul className="flex flex-col gap-2">
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              Your <em>email address</em> — required for sign-in. Stored on the
              application side as a SHA-256 hash; the raw address is held only by
              the magic-link store and the email delivery provider.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              Your <em>session cookie</em> — first-party, same-site strict,
              secure, short-lived, rotated on privilege escalation.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              <em>Plan content</em> — the imports you have asked the platform to
              cost. Treated as your data, subject to export and erasure.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              <em>Anonymous page-view counts</em> — opt-in. Vercel Analytics
              counts which pages people read. No behavioural tracking, no
              cross-site profiling, no advertising identifiers.
            </span>
          </li>
        </ul>
      </>
    ),
  },
  {
    numeral: 'III',
    title: 'How we protect it &mdash; data minimisation.',
    body: (
      <>
        <p>
          We design data flows to need as little personal information as
          possible. Email is hashed at the application boundary. Audit chains
          are stamped over GDPR-compatible projections that exclude raw
          personal data, so an erasure request does not corrupt the audit
          trail.
        </p>
        <p>
          We do not buy or enrich personal data. We do not use behavioural
          advertising, retargeting, or cross-site cookies.
        </p>
      </>
    ),
  },
  {
    numeral: 'IV',
    title: 'Cookies and similar technologies.',
    body: (
      <>
        <p>
          We use two categories. <em>Essential</em> cookies are required for
          sign-in, session continuity, and cache preferences. They are set on
          first request and are always on. <em>Analytics</em> cookies are
          opt-in and run Vercel Analytics page-view counters only.
        </p>
        <p>
          Your choice is stored locally as{' '}
          <code className="font-mono text-[13px]">orcatrade.consent.v1</code> and
          can be changed at any time through the &ldquo;Cookie preferences&rdquo;
          link in the footer.
        </p>
      </>
    ),
  },
  {
    numeral: 'V',
    title: 'Legal bases (UK and EU GDPR).',
    body: (
      <>
        <p>
          Essential cookies and account data: <em>contract</em> &mdash;
          necessary to operate the service you have signed up for. Analytics:{' '}
          <em>consent</em> &mdash; opt-in, withdrawable. Security and abuse
          monitoring: <em>legitimate interest</em> &mdash; balanced against your
          fundamental rights.
        </p>
      </>
    ),
  },
  {
    numeral: 'VI',
    title: 'How long we keep it.',
    body: (
      <>
        <p>
          Account data is kept for the life of your account and for one year
          after closure to support disputed billing or compliance enquiries.
          After that window it is pseudonymised &mdash; identity removed, the
          audit chain preserved.
        </p>
        <p>
          Magic-link tokens expire in fifteen minutes. Session cookies expire
          on browser close or after thirty days of inactivity, whichever comes
          first. Server logs are retained for ninety days.
        </p>
      </>
    ),
  },
  {
    numeral: 'VII',
    title: 'Who we share it with.',
    body: (
      <>
        <p>
          We use a short list of subprocessors, chosen for what they refuse to
          do as much as for what they do:
        </p>
        <ul className="flex flex-col gap-2">
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              <em>Vercel</em> &mdash; hosting and edge compute (EU regions
              preferred).
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              <em>Neon</em> &mdash; managed Postgres for the durable corpus
              (EU region).
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              <em>Upstash</em> &mdash; managed Redis for sessions and
              short-lived state.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              <em>Resend</em> &mdash; transactional email (sign-in links, weekly
              digests).
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              <em>Anthropic</em> &mdash; AI inference for prose generation only;
              never for numeric decisions.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              <em>Voyage</em> &mdash; vector embeddings for regulatory
              retrieval.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="mt-2.5 size-[3px] shrink-0 rounded-full bg-[var(--color-ivory-mute)]/60" />
            <span>
              <em>Sentry</em> &mdash; error monitoring (no PII in stack
              traces).
            </span>
          </li>
        </ul>
        <p>
          The list is updated on this page when it changes. We do not use
          advertising or behavioural-tracking subprocessors.
        </p>
      </>
    ),
  },
  {
    numeral: 'VIII',
    title: 'Your rights.',
    body: (
      <>
        <p>
          You can <em>access</em> everything we hold on you in one call:{' '}
          <code className="font-mono text-[13px]">GET /api/account/export</code>.
          You can <em>erase</em> your account in one call:{' '}
          <code className="font-mono text-[13px]">
            DELETE /api/account
          </code>
          . Erasure pseudonymises history rather than destroying it &mdash;
          the audit trail remains verifiable, your identity is removed.
        </p>
        <p>
          You also have the right to <em>rectify</em> incorrect data, to{' '}
          <em>restrict</em> processing, to <em>object</em>, and to lodge a
          complaint with your supervisory authority (UK ICO; in the EU, your
          national DPA).
        </p>
      </>
    ),
  },
  {
    numeral: 'IX',
    title: 'Security and disclosure.',
    body: (
      <>
        <p>
          HSTS, CSP, strict referrer policy, encrypted database connections,
          rotated secrets, audit-chained mutations. Responsible-disclosure
          contact: security@orcatradegroup.com. Acknowledged within one
          business day, triaged within three.
        </p>
      </>
    ),
  },
  {
    numeral: 'X',
    title: 'Changes to this policy.',
    body: (
      <>
        <p>
          We will post material changes to this page and, where the law
          requires, send a notice to the email on your account. We will not
          retro-apply weaker protections to data already collected under the
          previous version.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <>
      <EditorialHeader
        kicker="Privacy policy"
        title="How we handle your data."
        lead="Posture statements, not legal theatre. We collect the minimum, hash what we can, audit what we cannot, and erase what you ask us to."
        meta="Last reviewed · current quarter · MMXXVI"
      />

      <section className="bg-[var(--color-ink)] py-20 md:py-28">
        <LongForm sections={SECTIONS} />
      </section>
    </>
  );
}
