'use client';

import { useEffect, useState } from 'react';
import { apiGet, AuthError, type Obligation, type Severity } from '@/lib/api';

const SEV_CLASS: Record<string, string> = {
  critical: 'border-l-red-500',
  high: 'border-l-amber-500',
  medium: 'border-l-white/40',
  low: 'border-l-white/15',
};
const SEV_TEXT: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-amber-400',
  medium: 'text-white/70',
  low: 'text-white/55',
};

function dayLabel(n?: number) {
  if (n == null) return '';
  if (n <= 0) return 'due now';
  return `${n} day${n === 1 ? '' : 's'}`;
}

export default function CalendarPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [obligations, setObligations] = useState<Obligation[]>([]);

  useEffect(() => {
    apiGet<{ obligations: Obligation[] }>('/account/calendar')
      .then((d) => { setObligations(d.obligations || []); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading your compliance calendar…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see your deadlines</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load your calendar. Please retry shortly.</p>;

  return (
    <div>
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Compliance</div>
      <h1 className="text-4xl mb-2">Compliance calendar</h1>
      <p className="text-white/60 text-sm mb-8 max-w-2xl">
        Upcoming statutory deadlines (CBAM &amp; EUDR) derived from your saved plans, soonest first.
      </p>

      {!obligations.length ? (
        <div className="border border-dashed border-[var(--color-line)] px-6 py-10 text-center text-white/60">
          No upcoming CBAM or EUDR deadlines on your saved plans within the next year.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {obligations.map((o, i) => (
            <div key={i} className={`border border-[var(--color-line)] border-l-2 ${SEV_CLASS[o.severity || 'low']} px-5 py-4 flex items-baseline justify-between gap-4`}>
              <div className="min-w-0">
                <div className="font-mono text-[0.62rem] uppercase tracking-wider text-white/45 mb-1">{String(o.regime || '').toUpperCase()}</div>
                <div className="font-serif text-lg text-ivory">{o.title}</div>
                {o.detail && <p className="text-sm text-white/65 mt-1 leading-relaxed">{o.detail}</p>}
                {o.citation && <div className="font-mono text-[0.66rem] text-white/35 mt-1">{o.citation}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className={`font-mono text-lg ${SEV_TEXT[o.severity || 'low']}`}>{dayLabel(o.daysUntil)}</div>
                <div className="font-mono text-[0.66rem] text-white/45">{o.dueDate}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
