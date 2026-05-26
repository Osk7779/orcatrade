'use client';

import { useState } from 'react';
import { apiPost, type ScreenResult } from '@/lib/api';

const STATUS_COPY: Record<string, { label: string; cls: string }> = {
  potential_match: { label: 'Potential match — escalate', cls: 'text-red-400 border-l-red-500' },
  no_match: { label: 'No match on the loaded lists', cls: 'text-emerald-300 border-l-emerald-500' },
  no_sample_match: { label: 'No match on the sample list', cls: 'text-white/70 border-l-white/30' },
  invalid: { label: 'Not screenable', cls: 'text-amber-400 border-l-amber-500' },
};

export default function ScreeningPage() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScreenResult | null>(null);
  const [err, setErr] = useState('');

  async function screen(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr(''); setResult(null);
    try {
      setResult(await apiPost<ScreenResult>('/screen', { name: name.trim() }));
    } catch {
      setErr('Screening request failed. Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  const sc = result ? STATUS_COPY[result.status] || STATUS_COPY.no_sample_match : null;

  return (
    <div className="max-w-2xl">
      <div className="font-mono text-[0.7rem] tracking-[0.22em] uppercase text-[var(--color-accent-soft)] mb-2">Screening</div>
      <h1 className="text-4xl mb-2">Denied-party screening</h1>
      <p className="text-white/60 text-sm mb-7 leading-relaxed">
        Check a supplier, buyer or vessel name against the consolidated sanctions lists (OFAC · UK OFSI · UN · EU).
        Indicative only — it can flag a potential match, but never returns an all-clear.
      </p>

      <form onSubmit={screen} className="flex gap-2 mb-6">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Volcano Trading Company"
          className="flex-1 bg-white/[0.04] border border-[var(--color-line)] px-3 py-2 text-sm rounded-sm focus:outline-none focus:border-white/30"
        />
        <button disabled={busy || !name.trim()} className="px-4 py-2 text-sm font-medium bg-[var(--color-accent)] text-[var(--color-ink)] rounded-sm disabled:opacity-40">
          {busy ? 'Screening…' : 'Screen'}
        </button>
      </form>

      {err && <p className="text-red-400 text-sm">{err}</p>}

      {result && sc && (
        <div className={`border border-[var(--color-line)] border-l-2 ${sc.cls} px-5 py-4`}>
          <div className={`font-mono text-[0.7rem] uppercase tracking-wider mb-1 ${sc.cls.split(' ')[0]}`}>{sc.label}</div>
          <div className="text-sm text-white/70 mb-3">
            Screened “{result.query}” against {result.authoritative ? 'the loaded consolidated lists' : 'the illustrative sample'}
            {typeof result.matchCount === 'number' ? ` · ${result.matchCount} match${result.matchCount === 1 ? '' : 'es'}` : ''}.
          </div>
          {!!result.matches?.length && (
            <div className="border border-[var(--color-line)] divide-y divide-[var(--color-line)] mb-3">
              {result.matches.map((m, i) => (
                <div key={i} className="px-3 py-2 flex justify-between items-center text-sm">
                  <span className="text-ivory">{m.name}{m.programme ? <span className="text-white/45"> · {m.programme}</span> : null}</span>
                  <span className="font-mono text-xs text-white/55">{m.listSource} · {Math.round((m.score ?? 0) * 100)}%</span>
                </div>
              ))}
            </div>
          )}
          {result.advisory && <p className="text-white/50 text-xs leading-relaxed">{result.advisory}</p>}
        </div>
      )}
    </div>
  );
}
