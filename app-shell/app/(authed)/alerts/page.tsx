'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, AuthError, type Alert, type Severity } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice, EmptyState } from '@/components/States';

const SEV_RULE: Record<Severity, string> = {
  critical: 'before:bg-[var(--color-critical)]',
  high: 'before:bg-[var(--color-warning)]',
  medium: 'before:bg-[var(--color-ivory-dim)]',
  low: 'before:bg-[var(--color-navy-line)]',
  info: 'before:bg-[var(--color-info)]',
};
const SEV_LABEL: Record<Severity, string> = {
  critical: 'text-[var(--color-critical)]',
  high: 'text-[var(--color-warning)]',
  medium: 'text-[var(--color-ivory-dim)]',
  low: 'text-[var(--color-ivory-mute)]',
  info: 'text-[var(--color-info)]',
};
const TYPE_LABEL: Record<string, string> = {
  plan_cost_drift: 'Cost drift',
  portfolio_cost_drift: 'Portfolio drift',
  fx_exposure: 'FX exposure',
  compliance_deadline: 'Compliance deadline',
  sanctions_list_update: 'Sanctions update',
};

export default function AlertsPage() {
  const [state, setState] = useState<'loading' | 'auth' | 'error' | 'ready'>('loading');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [openCount, setOpenCount] = useState(0);

  const load = useCallback(() => {
    apiGet<{ alerts: Alert[]; openCount: number }>('/account/alerts')
      .then((d) => {
        setAlerts(d.alerts || []);
        setOpenCount(d.openCount || 0);
        setState('ready');
      })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(action: string, id?: string) {
    try {
      await apiPost('/account/alerts', { action, id });
      load();
    } catch {
      /* keep UI; reload will resync */
    }
  }

  if (state === 'loading') return <LoadingNotice label="Loading your alerts…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to see your alerts." />;
  if (state === 'error') return <ErrorNotice />;

  return (
    <div>
      <PageHeader
        kicker="Monitoring"
        title="Monitoring alerts."
        sub="The monitoring agent checks weekly for cost drift, FX exposure, deadlines and sanctions changes — and flags anything that has moved materially since you saved."
        actions={
          openCount > 0 ? (
            <button
              onClick={() => act('markAllRead')}
              className="inline-flex items-center gap-2 border border-[var(--color-navy-line)] px-4 py-2 font-mono text-[11.5px] font-medium tracking-tight text-[var(--color-ivory)] transition-all duration-500 hover:border-[var(--color-ivory-dim)] hover:bg-[var(--color-navy-soft)]"
            >
              Mark all read · {openCount}
            </button>
          ) : null
        }
      />

      {!alerts.length ? (
        <EmptyState body="Nothing flagged on your saved plans right now." />
      ) : (
        <div className="flex flex-col gap-3">
          {alerts.map((a) => (
            <article
              key={a.id}
              className={`relative bg-[var(--color-ink)] p-5 transition-opacity duration-500 before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] md:p-6 ${
                SEV_RULE[a.severity] || 'before:bg-[var(--color-navy-line)]'
              } ${a.status !== 'open' ? 'opacity-55' : ''}`}
              style={{ border: '1px solid var(--color-navy-line)' }}
            >
              <div className="flex flex-col items-start gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-3">
                    <span className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
                      {TYPE_LABEL[a.type] || a.type}
                    </span>
                    <span
                      className={`font-mono text-[10.5px] font-medium uppercase tabular-nums ${
                        SEV_LABEL[a.severity] || 'text-[var(--color-ivory-mute)]'
                      }`}
                    >
                      {a.severity}
                    </span>
                  </div>
                  <h3
                    className="mt-2 font-serif text-[1.15rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
                    style={{
                      fontVariationSettings: "'SOFT' 35, 'opsz' 144",
                      fontWeight: 550,
                    }}
                  >
                    {a.title}
                  </h3>
                  {a.body && (
                    <p className="mt-2 max-w-[60ch] text-[13.5px] leading-[1.6] text-[var(--color-ivory-dim)]">
                      {a.body}
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {a.status === 'open' && (
                  <button
                    onClick={() => act('markRead', a.id)}
                    className="inline-flex items-center gap-1.5 border border-[var(--color-navy-line)] px-3 py-1.5 font-mono text-[11px] font-medium tracking-tight text-[var(--color-ivory-dim)] transition-all duration-300 hover:border-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)]"
                  >
                    Mark read
                  </button>
                )}
                <button
                  onClick={() => act('dismiss', a.id)}
                  className="inline-flex items-center gap-1.5 border border-[var(--color-navy-line)] px-3 py-1.5 font-mono text-[11px] font-medium tracking-tight text-[var(--color-ivory-dim)] transition-all duration-300 hover:border-[var(--color-ivory-dim)] hover:text-[var(--color-ivory)]"
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
