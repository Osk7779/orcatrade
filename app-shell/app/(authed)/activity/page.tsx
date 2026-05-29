'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice, EmptyState } from '@/components/States';

interface ActivityEvent {
  id: string;
  at: string;
  action: string;
  actorEmail?: string;
  target?: { type: string; id: string; label?: string };
  ip?: string;
  ua?: string;
  city?: string;
  country?: string;
}

const ACTION_LABEL: Record<string, string> = {
  'plan.save': 'Saved a plan',
  'plan.update': 'Updated a plan',
  'plan.delete': 'Deleted a plan',
  'portfolio.save': 'Saved a portfolio',
  'portfolio.delete': 'Deleted a portfolio',
  'document.audit': 'Audited a document',
  'draft.save': 'Drafted a document',
  'draft.approve': 'Approved a draft',
  'draft.reject': 'Rejected a draft',
  'screen.run': 'Ran a denied-party screen',
  'alert.read': 'Marked an alert read',
  'alert.dismiss': 'Dismissed an alert',
  'auth.sign-in': 'Signed in',
  'auth.sign-out': 'Signed out',
  'auth.session.revoke': 'Revoked a session',
  'auth.password.set': 'Set a password',
  'auth.mfa.enable': 'Enabled two-factor',
  'auth.mfa.disable': 'Disabled two-factor',
  'account.export': 'Exported account data',
  'account.delete': 'Requested account deletion',
  'org.create': 'Created an organisation',
  'org.invite': 'Invited a colleague',
  'org.remove': 'Removed a colleague',
  'org.role': 'Changed a colleague’s role',
  'org.scim.mint': 'Generated a SCIM token',
  'org.scim.revoke': 'Revoked the SCIM token',
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ActivityPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    fetch('/api/account/activity', { credentials: 'include' })
      .then((r) => {
        if (r.status === 401) {
          setState('auth');
          return null;
        }
        if (!r.ok) throw new Error(`Activity endpoint returned ${r.status}`);
        return r.json();
      })
      .then((d: { events?: ActivityEvent[] } | null) => {
        if (d) {
          setEvents(d.events || []);
          setState('ready');
        }
      })
      .catch(() => setState('error'));
  }, []);

  if (state === 'loading') return <LoadingNotice label="Loading your activity log…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to see your activity." />;
  if (state === 'error') return <ErrorNotice />;

  return (
    <div className="max-w-[860px]">
      <PageHeader
        kicker="Account · activity"
        title="Activity log."
        sub="Every state change on your account, hash-stamped to the audit chain. The projection here excludes raw personal data — that protection is what lets erasure requests coexist with a verifiable audit trail."
      />

      {!events.length ? (
        <EmptyState body="No recorded activity yet." />
      ) : (
        <div className="border border-[var(--color-navy-line)]">
          {events.map((e, i) => {
            const label = ACTION_LABEL[e.action] || e.action;
            const where =
              e.city && e.country
                ? `${e.city}, ${e.country}`
                : e.country
                ? e.country
                : e.ip ?? '';
            return (
              <article
                key={e.id}
                className={`flex flex-col gap-3 px-5 py-4 md:flex-row md:items-baseline md:justify-between md:gap-6 md:px-6 md:py-5 ${
                  i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span
                      className="font-serif text-[14.5px] leading-tight text-[var(--color-ivory)]"
                      style={{
                        fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                        fontWeight: 550,
                      }}
                    >
                      {label}
                    </span>
                    {e.target && (
                      <span className="font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-ivory-mute)]">
                        {e.target.label || e.target.id}
                      </span>
                    )}
                  </div>
                  {where && (
                    <div className="mt-1 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
                      from {where}
                    </div>
                  )}
                </div>
                <time className="shrink-0 font-mono text-[12px] font-medium tabular-nums text-[var(--color-ivory-dim)]">
                  {fmtDate(e.at)}
                </time>
              </article>
            );
          })}
        </div>
      )}

      <p className="mt-8 max-w-[60ch] font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
        Full audit chain (with cryptographic verification): GET /api/audit?format=chain.
        The chain is independently verifiable end-to-end.
      </p>
    </div>
  );
}
