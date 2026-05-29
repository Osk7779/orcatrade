'use client';

import { useState } from 'react';
import { apiPost, type ScreenResult } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';

const STATUS_COPY: Record<string, { label: string; tone: string; rule: string }> = {
  potential_match: {
    label: 'Potential match — escalate',
    tone: 'text-[var(--color-critical)]',
    rule: 'before:bg-[var(--color-critical)]',
  },
  no_match: {
    label: 'No match on the loaded lists',
    tone: 'text-[var(--color-positive)]',
    rule: 'before:bg-[var(--color-positive)]',
  },
  no_sample_match: {
    label: 'No match on the sample list',
    tone: 'text-[var(--color-ivory-dim)]',
    rule: 'before:bg-[var(--color-ivory-dim)]',
  },
  invalid: {
    label: 'Not screenable',
    tone: 'text-[var(--color-warning)]',
    rule: 'before:bg-[var(--color-warning)]',
  },
};

export default function ScreeningPage() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScreenResult | null>(null);
  const [err, setErr] = useState('');

  async function screen(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr('');
    setResult(null);
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
    <div className="max-w-[820px]">
      <PageHeader
        kicker="Screening"
        title="Denied-party screening."
        sub="Check a supplier, buyer or vessel name against the consolidated sanctions lists (OFAC · UK OFSI · UN · EU). Indicative only — it can flag a potential match, but never returns an all-clear."
      />

      <form onSubmit={screen} className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Volcano Trading Company"
          className="flex-1 border-b border-[var(--color-navy-line)] bg-transparent px-1 py-3 text-[15px] text-[var(--color-ivory)] placeholder:text-[var(--color-ivory-mute)]/60 focus:border-[var(--color-ivory-dim)] focus:outline-none"
        />
        <button
          disabled={busy || !name.trim()}
          className="group inline-flex shrink-0 items-center justify-center gap-2 bg-[var(--color-ivory)] px-6 py-3 text-[12.5px] font-semibold text-[var(--color-ink)] transition-colors duration-500 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Screening…' : 'Screen'}
          {!busy && (
            <span
              aria-hidden
              className="transition-transform duration-500 group-hover:translate-x-0.5"
            >
              →
            </span>
          )}
        </button>
      </form>

      {err && (
        <div className="mt-6 border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-4">
          <p className="font-serif text-[14px] italic text-[var(--color-ivory)]">{err}</p>
        </div>
      )}

      {result && sc && (
        <div
          className={`relative mt-8 bg-[var(--color-ink)] p-6 before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] md:p-7 ${sc.rule}`}
          style={{ border: '1px solid var(--color-navy-line)' }}
        >
          <div
            className={`font-mono text-[11px] font-medium uppercase tracking-tight ${sc.tone}`}
          >
            {sc.label}
          </div>
          <div className="mt-3 max-w-[60ch] font-serif text-[15px] italic leading-[1.55] text-[var(--color-ivory-dim)]">
            Screened &ldquo;<span className="not-italic font-medium text-[var(--color-ivory)]">{result.query}</span>&rdquo; against{' '}
            {result.authoritative
              ? 'the loaded consolidated lists'
              : 'the illustrative sample'}
            {typeof result.matchCount === 'number'
              ? ` · ${result.matchCount} match${result.matchCount === 1 ? '' : 'es'}`
              : ''}
            .
          </div>
          {!!result.matches?.length && (
            <div className="mt-5 border border-[var(--color-navy-line)]">
              {result.matches.map((m, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-3 px-4 py-3 text-[13.5px] ${
                    i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
                  }`}
                >
                  <span className="text-[var(--color-ivory)]">
                    {m.name}
                    {m.programme && (
                      <span className="font-serif italic text-[var(--color-ivory-mute)]">
                        {' '}
                        · {m.programme}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11.5px] font-medium tabular-nums text-[var(--color-ivory-mute)]">
                    {m.listSource} · {Math.round((m.score ?? 0) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
          {result.advisory && (
            <p className="mt-5 max-w-[60ch] font-serif text-[12.5px] italic leading-[1.55] text-[var(--color-ivory-mute)]">
              {result.advisory}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
