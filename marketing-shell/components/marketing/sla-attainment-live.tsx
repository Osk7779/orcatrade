'use client';

import { useEffect, useState } from 'react';

// Public SLA attainment — sprint 85 (Track D). Fetches /api/sla and
// renders both measured commitments. Same honesty contract as the
// accuracy ledger: 'insufficient' withholds figures and shows the
// accruing state — a published SLA nobody can verify is a slogan,
// and one that flatters itself is worse.

interface Attainment {
  targetHours: number;
  sampleSize: number;
  tier: 'insufficient' | 'indicative' | 'measured';
  withinTargetPct: number | null;
  medianHours: number | null;
  p95Hours: number | null;
}

interface SlaResponse {
  ok: boolean;
  sla?: {
    windowDays: number;
    quoteTurnaround: Attainment;
    firstResponse: Attainment;
  };
  generatedAt?: string;
}

type State = 'loading' | 'error' | 'ready';

function CommitmentBlock({ title, note, a }: { title: string; note: string; a: Attainment }) {
  const withheld = a.tier === 'insufficient';
  return (
    <div className="border border-white/[0.08] bg-white/[0.02] p-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-ivory-mute)]">
        {title} · target {a.targetHours}h
      </p>
      {withheld ? (
        <p className="mt-4 text-[14.5px] leading-[1.7] text-[var(--color-ivory-dim)]">
          <span className="font-mono text-[20px] text-[var(--color-ivory)]">{a.sampleSize}</span>{' '}
          in sample — attainment publishes at ten scoreable rows, exactly like the accuracy
          ledger. Nothing is back-filled or guessed.
        </p>
      ) : (
        <div className="mt-5 grid grid-cols-3 gap-4">
          <div>
            <p className="font-mono text-[26px] leading-none text-[var(--color-ivory)]">
              {a.withinTargetPct == null ? '—' : `${a.withinTargetPct}%`}
            </p>
            <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--color-ivory-mute)]">
              within target
            </p>
          </div>
          <div>
            <p className="font-mono text-[26px] leading-none text-[var(--color-ivory)]">
              {a.medianHours == null ? '—' : `${a.medianHours}h`}
            </p>
            <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--color-ivory-mute)]">
              median
            </p>
          </div>
          <div>
            <p className="font-mono text-[26px] leading-none text-[var(--color-ivory)]">
              {a.p95Hours == null ? '—' : `${a.p95Hours}h`}
            </p>
            <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--color-ivory-mute)]">
              p95
            </p>
          </div>
        </div>
      )}
      {a.tier === 'indicative' && (
        <p className="mt-4 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
          Early sample ({a.sampleSize}) — figures firm up at fifty.
        </p>
      )}
      <p className="mt-4 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">{note}</p>
    </div>
  );
}

export function SlaAttainmentLive() {
  const [state, setState] = useState<State>('loading');
  const [data, setData] = useState<SlaResponse['sla'] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/sla', { credentials: 'omit' });
        if (!res.ok) throw new Error('sla HTTP ' + res.status);
        const body: SlaResponse = await res.json();
        if (!alive) return;
        if (!body || !body.sla) throw new Error('sla body malformed');
        setData(body.sla);
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
        Loading attainment…
      </p>
    );
  }
  if (state === 'error' || !data) {
    return (
      <p className="font-serif text-[14px] italic text-[var(--color-ivory-mute)]">
        The attainment endpoint is unreachable right now. It recomputes statelessly — try again in
        a minute.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <CommitmentBlock
          title="Quote turnaround"
          note="First-quote times only — a rework never launders a slow first answer."
          a={data.quoteTurnaround}
        />
        <CommitmentBlock
          title="First human response"
          note="Automated transitions never stop this clock — the stamp requires a human action."
          a={data.firstResponse}
        />
      </div>
      <p className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
        Rolling {data.windowDays}-day window
        {generatedAt
          ? ` · recomputed ${String(generatedAt).slice(0, 10)} ${String(generatedAt).slice(11, 16)} UTC`
          : ''}{' '}
        — statelessly, from the stamped timestamps. There is no stored figure to adjust.
      </p>
    </div>
  );
}
