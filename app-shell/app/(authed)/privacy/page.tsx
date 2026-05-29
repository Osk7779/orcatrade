'use client';

import { useState } from 'react';
import { AuthError } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { AuthNotice } from '@/components/States';

// GDPR data rights. Export (one call, returns JSON) and delete (typed
// confirmation, pseudonymises history rather than destroying it so the
// audit chain stays verifiable). Auth-gated via /api/auth/me check.
export default function PrivacyPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteDone, setDeleteDone] = useState(false);

  // Resolve current account once on mount; tolerate failures.
  useState(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new AuthError())))
      .then((d: { email?: string }) => {
        setEmail(d?.email ?? '');
        setAuthed(true);
      })
      .catch(() => setAuthed(false));
  });

  if (authed === null) return null;
  if (authed === false) return <AuthNotice title="Sign in to manage your data." />;

  async function exportData() {
    setExporting(true);
    setExportError('');
    try {
      const res = await fetch('/api/account/export', { credentials: 'include' });
      if (!res.ok) throw new Error(`Export endpoint returned ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orcatrade-account-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE', email: confirmEmail.trim() }),
      });
      if (!res.ok) throw new Error(`Delete endpoint returned ${res.status}`);
      setDeleteDone(true);
      setTimeout(() => {
        window.location.href = '/';
      }, 4000);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }

  const deleteEnabled =
    confirmEmail.trim().toLowerCase() === email.trim().toLowerCase() &&
    confirmEmail.length > 0;

  if (deleteDone) {
    return (
      <div className="max-w-[560px]">
        <PageHeader
          kicker="Account deleted"
          title="Your account has been pseudonymised."
          sub="We have removed your identity from the platform. The audit chain stays intact with your data projected out. You will be redirected to the homepage in a moment."
        />
      </div>
    );
  }

  return (
    <div className="max-w-[760px]">
      <PageHeader
        kicker="Privacy & data"
        title="Manage your data."
        sub="Export everything we hold on you in one call, or erase your account permanently. Erasure removes your identity but preserves the audit chain — your events stay on record, your name does not."
        meta={email}
      />

      {/* Export */}
      <section className="border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-6 md:p-8">
        <SectionHead kicker="Export your data" />
        <p className="max-w-[60ch] text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
          A complete JSON dump of your saved plans, portfolios, monitoring alerts,
          compliance calendar, documents, drafts, screening history and
          preferences. Provided in a single file you can keep offline.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={exportData}
            disabled={exporting}
            className="group inline-flex items-center gap-2 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {exporting ? 'Preparing your export…' : 'Download my data'}
            {!exporting && (
              <span
                aria-hidden
                className="transition-transform duration-500 group-hover:translate-x-0.5"
              >
                ↓
              </span>
            )}
          </button>
          <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
            JSON · single file · no email required
          </span>
        </div>
        {exportError && (
          <div className="mt-5 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
            <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{exportError}</p>
          </div>
        )}
      </section>

      {/* Delete */}
      <section
        className="relative mt-10 bg-[var(--color-ink)] p-6 before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] before:bg-[var(--color-critical)] md:p-8"
        style={{ border: '1px solid var(--color-navy-line)' }}
      >
        <SectionHead kicker="Delete your account" tone="critical" />
        <p className="max-w-[60ch] text-[14.5px] leading-[1.65] text-[var(--color-ivory-dim)]">
          Permanently pseudonymises every record we hold on you. The audit chain is
          preserved with your identity projected out, so the chain stays verifiable
          — but your name, email and all account state are gone. This is not
          reversible.
        </p>

        <div className="mt-6 max-w-[440px]">
          <label className="flex flex-col gap-2">
            <span className="font-serif text-[13px] italic text-[var(--color-ivory-dim)]">
              Type your email to confirm
            </span>
            <input
              type="email"
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={email}
              className="border-b border-[var(--color-navy-line)] bg-transparent px-1 py-2.5 text-[14.5px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-critical)] focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={deleteAccount}
            disabled={!deleteEnabled || deleting}
            className="inline-flex items-center gap-2 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/10 px-6 py-3 text-[12.5px] font-semibold text-[var(--color-critical)] transition-colors duration-500 hover:bg-[var(--color-critical)]/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {deleting ? 'Deleting…' : 'Delete my account permanently'}
          </button>
          <span className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
            Not reversible
          </span>
        </div>

        {deleteError && (
          <div className="mt-5 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
            <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{deleteError}</p>
          </div>
        )}
      </section>

      <p className="mt-10 max-w-[60ch] font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
        Our full privacy posture, including subprocessors and security disclosures,
        lives at{' '}
        <a
          href="/regulations/privacy"
          className="underline-offset-4 hover:text-[var(--color-ivory)] hover:underline"
        >
          orcatrade.pl/regulations/privacy
        </a>
        .
      </p>
    </div>
  );
}

function SectionHead({ kicker, tone }: { kicker: string; tone?: 'critical' }) {
  return (
    <div className="mb-5 flex items-baseline gap-3 border-b border-[var(--color-navy-line)] pb-3">
      <span
        aria-hidden
        className={
          tone === 'critical'
            ? 'font-serif text-[12.5px] text-[var(--color-critical)]/70'
            : 'font-serif text-[12.5px] text-[var(--color-ivory-dim)]/60'
        }
      >
        ❦
      </span>
      <span
        className="font-serif text-[1rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
        style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
      >
        {kicker}
      </span>
    </div>
  );
}
