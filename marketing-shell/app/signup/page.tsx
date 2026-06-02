import type { Metadata } from 'next';
import { EditorialHeader } from '@/components/marketing/editorial-header';
import { SignupForm } from '@/components/marketing/signup-form';

export const metadata: Metadata = {
  title: 'Sign up — OrcaTrade Group',
  description:
    'Create an OrcaTrade account. Magic-link or password — your choice. Email confirmation required; nothing created until you click.',
};

export default function SignupPage() {
  return (
    <>
      <EditorialHeader
        kicker="Sign up"
        title={<>One account, every surface.</>}
        lead="Your sign-up gives you the Free tier — twenty agent queries a month, the compliance brief, the wizard, your own audit trail. No payment method required. Magic-link by default; you can add a password once you are in."
        meta="Free forever · no payment up front · GDPR-compatible"
      />
      <section className="bg-[var(--color-ink)] py-14 md:py-20">
        <div className="mx-auto max-w-[480px] px-6">
          <SignupForm />
        </div>
      </section>
    </>
  );
}
