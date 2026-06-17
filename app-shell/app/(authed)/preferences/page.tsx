'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, AuthError, type Prefs } from '@/lib/api';

type ToggleGroup = {
  heading: string;
  blurb?: string;
  toggles: Array<{ key: keyof Prefs; label: string; desc: string }>;
};

// Sprint 24 — three groups. Operator-wedge emails are split into
// "your requests" (customer-side) and "your queue" (ops-side, only
// relevant when the user has admin/owner role somewhere).
const TOGGLE_GROUPS: ToggleGroup[] = [
  {
    heading: 'Your import requests',
    blurb: 'Emails the team sends you about requests you submitted.',
    toggles: [
      { key: 'importQuoteReadyEmails', label: 'Quote ready', desc: 'When our team approves a quote on a request you submitted.' },
      { key: 'importDeclineEmails', label: 'Declines + revision prompts', desc: 'When a request is declined with a structured reason — includes the "Revise" CTA.' },
      { key: 'importShipmentStatusEmails', label: 'Shipment status updates', desc: 'When a shipment from your approved request changes status (booked / in transit / cleared / delivered / exception).' },
      { key: 'importMessageEmails', label: 'New messages on a thread', desc: 'When ops posts a message on one of your request threads.' },
    ],
  },
  {
    heading: 'Ops inbox',
    blurb: 'For admin + owner roles. Customer-side users do not receive these.',
    toggles: [
      { key: 'importQueueIntakeEmails', label: 'New requests in queue', desc: 'When a customer submits a new request and the orchestrator surfaces a quote awaiting team review.' },
      { key: 'importCustomerDecisionEmails', label: 'Customer decisions', desc: 'When a customer approves or rejects a quote your team sent them.' },
      { key: 'importMessageEmails', label: 'Customer messages on threads', desc: 'When a customer posts a question or follow-up on a request thread.' },
      { key: 'importInsightsDigestEmails', label: 'Weekly insights digest', desc: 'Monday morning summary: funnel by status, top decline reasons, and revision recovery for the last 7 days. Calculator-grounded — same numbers as the live cockpit.' },
      { key: 'importLowRatingAlertEmails', label: 'Low-rating alert (1-2★)', desc: 'Immediate alert when a customer rates a request 1 or 2 stars. Outreach within 24 hours; a 1-2★ rating left unanswered is the strongest churn signal we track.' },
    ],
  },
  {
    heading: 'Saved-plan emails',
    blurb: 'Legacy notifications for the saved-plan workflows.',
    toggles: [
      { key: 'monitoringAlerts', label: 'Monitoring alerts', desc: 'Weekly digest when a saved plan drifts, an FX exposure opens, or sanctions lists change.' },
      { key: 'complianceDeadlineEmails', label: 'Compliance deadline reminders', desc: 'Upcoming CBAM / EUDR deadlines on your saved plans.' },
      { key: 'planRevisionEmails', label: 'Plan-revision emails', desc: 'When a saved plan’s landed cost moves materially.' },
      { key: 'weeklyDigestEmails', label: 'Weekly digest', desc: 'A weekly summary across your saved plans.' },
    ],
  },
];

// Default value for missing pref keys. The server treats absence as
// "true" (opt-out posture), and the UI mirrors that so a never-saved
// pref renders as ON. Without this, every toggle would start as OFF
// on first load, misleading the user about their actual state.
function prefValue(prefs: Prefs, key: keyof Prefs): boolean {
  const v = prefs[key];
  if (typeof v === 'boolean') return v;
  return true;
}

const LOCALES = [{ v: 'en', l: 'English' }, { v: 'pl', l: 'Polski' }, { v: 'de', l: 'Deutsch' }];

export default function PreferencesPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [prefs, setPrefs] = useState<Prefs>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ prefs: Prefs }>('/account/preferences')
      .then((d) => { setPrefs(d.prefs || {}); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  async function update(patch: Partial<Prefs>, key: string) {
    setSaving(key);
    const prev = prefs;
    setPrefs({ ...prefs, ...patch }); // optimistic
    try {
      const d = await apiPost<{ prefs: Prefs }>('/account/preferences', patch);
      setPrefs(d.prefs);
    } catch {
      setPrefs(prev); // revert on failure
    } finally {
      setSaving(null);
    }
  }

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading your preferences…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to manage preferences</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load your preferences. Please retry shortly.</p>;

  return (
    <div className="max-w-2xl">
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Account</div>
      <h1 className="text-4xl mb-8">Preferences</h1>

      {/* Sprint 24 — grouped toggles. "Your import requests" sits at the
          top so customer-side users see THEIR category first; ops-only
          toggles below; legacy saved-plan toggles last. */}
      {TOGGLE_GROUPS.map((group) => (
        <section key={group.heading} className="mb-10">
          <h2 className="text-xl mb-2">{group.heading}</h2>
          {group.blurb && (
            <p className="text-white/50 text-sm mb-3">{group.blurb}</p>
          )}
          <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
            {group.toggles.map((t) => {
              const on = prefValue(prefs, t.key);
              return (
                <div key={`${group.heading}:${t.key}`} className="flex items-center justify-between gap-6 px-5 py-4">
                  <div>
                    <div className="text-ivory">{t.label}</div>
                    <div className="text-white/55 text-sm mt-0.5">{t.desc}</div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={on}
                    disabled={saving === t.key}
                    onClick={() => update({ [t.key]: !on } as Partial<Prefs>, t.key)}
                    className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${on ? 'bg-[var(--color-accent)]' : 'bg-white/15'} disabled:opacity-50`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-[var(--color-ink)] transition-all ${on ? 'left-[1.4rem]' : 'left-0.5'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <h2 className="text-xl mb-3">Language</h2>
      <select
        value={prefs.locale || 'en'}
        disabled={saving === 'locale'}
        onChange={(e) => update({ locale: e.target.value }, 'locale')}
        className="bg-white/[0.04] border border-[var(--color-line)] px-3 py-2 text-sm rounded-sm"
      >
        {LOCALES.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
      </select>
      <p className="text-white/40 text-xs mt-3">Sets the language of your transactional emails.</p>

      <p className="text-white/40 text-xs mt-10 pt-6 border-t border-[var(--color-line)]">
        Manage your data (export or delete) on the <a className="underline" href="/account/privacy/">Privacy &amp; data</a> page.
      </p>
    </div>
  );
}
