'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, AuthError, type Alert, type Severity } from '@/lib/api';

const SEV_CLASS: Record<Severity, string> = {
  critical: 'border-l-red-500',
  high: 'border-l-amber-500',
  medium: 'border-l-white/40',
  low: 'border-l-white/15',
  info: 'border-l-sky-500/60',
};
const SEV_TEXT: Record<Severity, string> = {
  critical: 'text-red-400',
  high: 'text-amber-400',
  medium: 'text-white/70',
  low: 'text-white/55',
  info: 'text-sky-400',
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
      .then((d) => { setAlerts(d.alerts || []); setOpenCount(d.openCount || 0); setState('ready'); })
      .catch((e) => setState(e instanceof AuthError ? 'auth' : 'error'));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(action: string, id?: string) {
    try { await apiPost('/account/alerts', { action, id }); load(); } catch { /* keep UI; reload will resync */ }
  }

  if (state === 'loading') return <p className="text-white/50 text-sm">Loading your alerts…</p>;
  if (state === 'auth') {
    return (
      <div className="max-w-md">
        <h1 className="text-3xl mb-3">Sign in to see your alerts</h1>
        <a href="/account/" className="inline-block px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm">Sign in →</a>
      </div>
    );
  }
  if (state === 'error') return <p className="text-red-400 text-sm">Couldn’t load your alerts. Please retry shortly.</p>;

  return (
    <div>
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Monitoring</div>
      <div className="flex items-end justify-between mb-8">
        <h1 className="text-4xl">Monitoring alerts</h1>
        {openCount > 0 && (
          <button onClick={() => act('markAllRead')} className="text-xs font-mono px-3 py-2 border border-[var(--color-line)] hover:bg-white/5">
            Mark all read ({openCount})
          </button>
        )}
      </div>

      {!alerts.length ? (
        <div className="border border-dashed border-[var(--color-line)] px-6 py-10 text-center text-white/60">
          Nothing flagged on your saved plans right now. The monitoring agent checks weekly for cost drift, FX exposure, deadlines and sanctions changes.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {alerts.map((a) => (
            <div key={a.id} className={`border border-[var(--color-line)] border-l-2 ${SEV_CLASS[a.severity] || 'border-l-white/20'} ${a.status !== 'open' ? 'opacity-55' : ''} px-5 py-4`}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-mono text-[0.62rem] uppercase tracking-wider text-white/45 mb-1">{TYPE_LABEL[a.type] || a.type}</div>
                  <div className="font-serif text-lg text-ivory">{a.title}</div>
                  {a.body && <p className="text-sm text-white/65 mt-1 leading-relaxed">{a.body}</p>}
                </div>
                <span className={`font-mono text-[0.62rem] uppercase shrink-0 ${SEV_TEXT[a.severity] || 'text-white/50'}`}>{a.severity}</span>
              </div>
              <div className="flex gap-2 mt-3">
                {a.status === 'open' && (
                  <button onClick={() => act('markRead', a.id)} className="text-[0.7rem] font-mono px-2.5 py-1 border border-[var(--color-line)] hover:bg-white/5">Mark read</button>
                )}
                <button onClick={() => act('dismiss', a.id)} className="text-[0.7rem] font-mono px-2.5 py-1 border border-[var(--color-line)] hover:bg-white/5">Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
