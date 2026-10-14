'use client';

import { useEffect, useState } from 'react';

// Quote Accuracy Ledger — sprint 80 (Track B). Fetches /api/accuracy
// (same-origin via the platform rewrite) and renders the measured
// quote-vs-actuals instrument.
//
// The honest-tier contract is the load-bearing part of this render:
//   'insufficient' → headline metrics are null server-side; we show
//     the live-instrument state with the running count — NEVER a
//     placeholder percentage. A trust page that flatters itself is
//     worse than no trust page.
//   'indicative'   → metrics render with an explicit early-sample
//     label.
//   'measured'     → the full instrument.

interface Ledger {
  sampleSize: number;
  tier: 'insufficient' | 'indicative' | 'measured';
  within5Pct: number | null;
  within10Pct: number | null;
  within20Pct: number | null;
  medianAbsErrorPct: number | null;
  valueWeightedBiasPct: number | null;
  totalEstimateCents: number;
  totalActualCents: number;
  oldestReportedAt: string | null;
  newestReportedAt: string | null;
}

interface AccuracyResponse {
  ok: boolean;
  ledger?: Ledger;
  generatedAt?: string;
}

function eurFromCents(cents: number): string {
  return '€' + Math.round(cents / 100).toLocaleString('en-IE');
}

type State = 'loading' | 'error' | 'ready';

export function AccuracyLedgerLive() {
  const [state, setState] = useState<State>('loading');
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/accuracy', { credentials: 'omit' });
        if (!res.ok) throw new Error('accuracy HTTP ' + res.status);
        const body: AccuracyResponse = await res.json();
        if (!alive) return;
        if (!body || !body.ledger) throw new Error('accuracy body malformed');
        setLedger(body.ledger);
        setGeneratedAt(body.generatedAt ?? null);
        setState('ready');
      } catch {
        if (alive) setState('error');
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'loading') {
    return (
      <p className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
        Loading the ledger…
      </p>
    );
  }
  if (state === 'error' || !ledger) {
    return (
      <p className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
        The ledger endpoint is unreachable right now. It recomputes statelessly — try again in a
        minute.
      </p>
    );
  }

  if (ledger.tier === 'insufficient') {
    return (
      <div className="border border-white/[0.08] bg-white/[0.02] p-8 md:p-10">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ivory-mute)]">
          Instrument live · accruing sample
        </p>
        <p className="mt-4 text-[15px] leading-[1.7] text-[var(--color-ivory-dim)]">
          <span className="font-mono text-[22px] text-[var(--color-ivory)]">{ledger.sampleSize}</span>{' '}
          reported actual{ledger.sampleSize === 1 ? '' : 's'} on record. Headline accuracy figures
          publish automatically once ten scoreable outcomes exist — below that line a median is
          marketing, not measurement, so we withhold it. The methodology below is already binding.
        </p>
      </div>
    );
  }

  const bands: Array<{ label: string; value: number | null }> = [
    { label: 'within ±5%', value: ledger.within5Pct },
    { label: 'within ±10%', value: ledger.within10Pct },
    { label: 'within ±20%', value: ledger.within20Pct },
  ];

  return (
    <div className="space-y-8">
      {ledger.tier === 'indicative' && (
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ivory-mute)]">
          Early sample · {ledger.sampleSize} actuals — figures firm up at 50
        </p>
      )}
      <div className="grid grid-cols-1 gap-px bg-white/[0.06] md:grid-cols-3">
        {bands.map((b) => (
          <div key={b.label} className="bg-[var(--color-ink)] p-8 text-center">
            <p className="font-mono text-[34px] leading-none text-[var(--color-ivory)]">
              {b.value == null ? '—' : `${b.value}%`}
            </p>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
              of quotes landed {b.label}
            </p>
          </div>
        ))}
      </div>
      <dl className="grid grid-cols-1 gap-6 text-[14px] leading-[1.65] text-[var(--color-ivory-dim)] md:grid-cols-3">
        <div>
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
            Median absolute error
          </dt>
          <dd className="mt-2 font-mono text-[18px] text-[var(--color-ivory)]">
            {ledger.medianAbsErrorPct == null ? '—' : `${ledger.medianAbsErrorPct}%`}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
            Value-weighted bias
          </dt>
          <dd className="mt-2 font-mono text-[18px] text-[var(--color-ivory)]">
            {ledger.valueWeightedBiasPct == null
              ? '—'
              : `${ledger.valueWeightedBiasPct > 0 ? '+' : ''}${ledger.valueWeightedBiasPct}%`}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--color-ivory-mute)]">
            Measured over
          </dt>
          <dd className="mt-2 font-mono text-[18px] text-[var(--color-ivory)]">
            {ledger.sampleSize} outcomes · {eurFromCents(ledger.totalActualCents)}
          </dd>
        </div>
      </dl>
      {generatedAt && (
        <p className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
          Recomputed {String(generatedAt).slice(0, 10)} {String(generatedAt).slice(11, 16)} UTC —
          statelessly, from the full corpus. There is no stored figure to adjust.
        </p>
      )}
    </div>
  );
}
