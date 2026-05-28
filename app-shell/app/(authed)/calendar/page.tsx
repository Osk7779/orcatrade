'use client';

import { useEffect, useState } from 'react';
import { apiGet, AuthError, type Obligation } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice, EmptyState } from '@/components/States';

const SEV_RULE: Record<string, string> = {
  critical: 'before:bg-[var(--color-critical)]',
  high: 'before:bg-[var(--color-warning)]',
  medium: 'before:bg-[var(--color-ivory-dim)]',
  low: 'before:bg-[var(--color-navy-line)]',
};
const SEV_LABEL: Record<string, string> = {
  critical: 'text-[var(--color-critical)]',
  high: 'text-[var(--color-warning)]',
  medium: 'text-[var(--color-ivory)]',
  low: 'text-[var(--color-ivory-dim)]',
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
      .then((d) => {
        setObligations(d.obligations || []);
        setState('ready');
      })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  if (state === 'loading') return <LoadingNotice label="Loading your compliance calendar…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to see your deadlines." />;
  if (state === 'error') return <ErrorNotice />;

  return (
    <div>
      <PageHeader
        kicker="Compliance"
        title="Compliance calendar."
        sub="Upcoming statutory deadlines (CBAM and EUDR) derived from your saved plans, soonest first."
      />

      {!obligations.length ? (
        <EmptyState body="No upcoming CBAM or EUDR deadlines on your saved plans within the next year." />
      ) : (
        <div className="flex flex-col gap-3">
          {obligations.map((o, i) => (
            <article
              key={i}
              className={`relative bg-[var(--color-ink)] p-5 transition-colors duration-500 before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] hover:bg-[var(--color-navy-soft)] md:p-6 ${
                SEV_RULE[o.severity || 'low']
              }`}
              style={{ border: '1px solid var(--color-navy-line)' }}
            >
              <div className="flex flex-col items-start gap-4 md:flex-row md:items-baseline md:justify-between md:gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[10.5px] font-medium uppercase tabular-nums text-[var(--color-ivory-mute)]">
                      {String(o.regime || '').toUpperCase()}
                    </span>
                  </div>
                  <h3
                    className="mt-2 font-serif text-[1.2rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
                    style={{
                      fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                      fontWeight: 550,
                    }}
                  >
                    {o.title}
                  </h3>
                  {o.detail && (
                    <p className="mt-2 max-w-[60ch] text-[13.5px] leading-[1.6] text-[var(--color-ivory-dim)]">
                      {o.detail}
                    </p>
                  )}
                  {o.citation && (
                    <div className="mt-2 font-mono text-[11px] tracking-tight text-[var(--color-ivory-mute)]">
                      {o.citation}
                    </div>
                  )}
                </div>
                <div className="text-left md:text-right shrink-0">
                  <div
                    className={`font-mono text-[1.05rem] font-medium tabular-nums ${
                      SEV_LABEL[o.severity || 'low']
                    }`}
                  >
                    {dayLabel(o.daysUntil)}
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-[var(--color-ivory-mute)]">
                    {o.dueDate}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
