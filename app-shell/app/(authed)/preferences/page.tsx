'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, AuthError, type Prefs } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice } from '@/components/States';

const TOGGLES: Array<{ key: keyof Prefs; label: string; desc: string }> = [
  {
    key: 'monitoringAlerts',
    label: 'Monitoring alerts',
    desc: 'Weekly digest when a saved plan drifts, an FX exposure opens, or sanctions lists change.',
  },
  {
    key: 'complianceDeadlineEmails',
    label: 'Compliance deadline reminders',
    desc: 'Upcoming CBAM / EUDR deadlines on your saved plans.',
  },
  {
    key: 'planRevisionEmails',
    label: 'Plan-revision emails',
    desc: "When a saved plan's landed cost moves materially.",
  },
  {
    key: 'weeklyDigestEmails',
    label: 'Weekly digest',
    desc: 'A weekly summary across your saved plans.',
  },
];

const LOCALES = [
  { v: 'en', l: 'English' },
  { v: 'pl', l: 'Polski' },
  { v: 'de', l: 'Deutsch' },
];

export default function PreferencesPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [prefs, setPrefs] = useState<Prefs>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ prefs: Prefs }>('/account/preferences')
      .then((d) => {
        setPrefs(d.prefs || {});
        setState('ready');
      })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  async function update(patch: Partial<Prefs>, key: string) {
    setSaving(key);
    const prev = prefs;
    setPrefs({ ...prefs, ...patch });
    try {
      const d = await apiPost<{ prefs: Prefs }>('/account/preferences', patch);
      setPrefs(d.prefs);
    } catch {
      setPrefs(prev);
    } finally {
      setSaving(null);
    }
  }

  if (state === 'loading') return <LoadingNotice label="Loading your preferences…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to manage preferences." />;
  if (state === 'error') return <ErrorNotice />;

  return (
    <div className="max-w-[760px]">
      <PageHeader
        kicker="Account"
        title="Preferences."
        sub="Control which transactional emails you receive, and which language they arrive in. Data export and deletion live on the Privacy and data page."
      />

      <SectionHead kicker="Emails" />
      <div className="border border-[var(--color-navy-line)]">
        {TOGGLES.map((t, i) => {
          const on = !!prefs[t.key];
          return (
            <div
              key={t.key}
              className={`flex items-start justify-between gap-6 px-5 py-5 md:px-6 ${
                i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
              }`}
            >
              <div className="flex-1">
                <div className="font-serif text-[15px] leading-tight text-[var(--color-ivory)]">
                  {t.label}
                </div>
                <div className="mt-1.5 text-[13.5px] leading-[1.55] text-[var(--color-ivory-dim)]">
                  {t.desc}
                </div>
              </div>
              <Toggle
                checked={on}
                disabled={saving === t.key}
                onChange={(v) => update({ [t.key]: v } as Partial<Prefs>, t.key)}
                label={t.label}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-12">
        <SectionHead kicker="Language" />
        <div className="max-w-[360px]">
          <select
            value={prefs.locale || 'en'}
            disabled={saving === 'locale'}
            onChange={(e) => update({ locale: e.target.value }, 'locale')}
            className="w-full border-b border-[var(--color-navy-line)] bg-transparent py-2.5 text-[15px] text-[var(--color-ivory)] focus:border-[var(--color-ivory-dim)] focus:outline-none [&>option]:bg-[var(--color-ink)] [&>option]:text-[var(--color-ivory)]"
          >
            {LOCALES.map((l) => (
              <option key={l.v} value={l.v}>
                {l.l}
              </option>
            ))}
          </select>
          <p className="mt-3 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
            Sets the language of your transactional emails.
          </p>
        </div>
      </div>

      <p className="mt-12 border-t border-[var(--color-navy-line)] pt-6 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
        Manage your data (export or delete) on the{' '}
        <a
          className="underline-offset-4 hover:text-[var(--color-ivory)] hover:underline"
          href="/account/privacy/"
        >
          Privacy &amp; data
        </a>{' '}
        page.
      </p>
    </div>
  );
}

function SectionHead({ kicker }: { kicker: string }) {
  return (
    <div className="mb-5 flex items-baseline gap-3 border-b border-[var(--color-navy-line)] pb-3">
      <span aria-hidden className="font-serif text-[12.5px] text-[var(--color-ivory-dim)]/60">
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

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 border transition-colors duration-300 disabled:opacity-50 ${
        checked
          ? 'border-[var(--color-ivory-dim)]/60 bg-[var(--color-ivory)]/15'
          : 'border-[var(--color-navy-line)] bg-[var(--color-ink)]'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-1/2 size-[16px] -translate-y-1/2 transition-all duration-300 ${
          checked
            ? 'left-[24px] bg-[var(--color-ivory)]'
            : 'left-[3px] bg-[var(--color-ivory-dim)]'
        }`}
      />
    </button>
  );
}
