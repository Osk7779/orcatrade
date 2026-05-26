'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, AuthError, type Prefs } from '@/lib/api';

const TOGGLES: Array<{ key: keyof Prefs; label: string; desc: string }> = [
  { key: 'monitoringAlerts', label: 'Monitoring alerts', desc: 'Weekly digest when a saved plan drifts, an FX exposure opens, or sanctions lists change.' },
  { key: 'complianceDeadlineEmails', label: 'Compliance deadline reminders', desc: 'Upcoming CBAM / EUDR deadlines on your saved plans.' },
  { key: 'planRevisionEmails', label: 'Plan-revision emails', desc: 'When a saved plan’s landed cost moves materially.' },
  { key: 'weeklyDigestEmails', label: 'Weekly digest', desc: 'A weekly summary across your saved plans.' },
];

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

      <h2 className="text-xl mb-3">Emails</h2>
      <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)] mb-10">
        {TOGGLES.map((t) => {
          const on = !!prefs[t.key];
          return (
            <div key={t.key} className="flex items-center justify-between gap-6 px-5 py-4">
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
