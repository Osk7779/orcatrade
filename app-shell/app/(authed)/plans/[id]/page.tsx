'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet, AuthError, type SavedPlan, type Reproduction } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { LoadingNotice, ErrorNotice, AuthNotice } from '@/components/States';

function eur(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '€' + Math.round(n).toLocaleString('en-IE');
}

function fmtVal(v: unknown) {
  if (v == null) return '—';
  return String(v);
}

export default function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<'loading' | 'auth' | 'missing' | 'error' | 'ready'>(
    'loading',
  );
  const [plan, setPlan] = useState<SavedPlan | null>(null);
  const [repro, setRepro] = useState<Reproduction | null>(null);

  useEffect(() => {
    apiGet<{ ok: boolean; plan: SavedPlan }>(`/plans/${id}`)
      .then((d) => {
        setPlan(d.plan);
        setState('ready');
      })
      .catch((e) => {
        if (e instanceof AuthError) setState('auth');
        else if (String(e).includes('404')) setState('missing');
        else setState('error');
      });
    apiGet<Reproduction>(`/plans/${id}/reproduce`).then(setRepro).catch(() => {});
  }, [id]);

  if (state === 'loading') return <LoadingNotice label="Loading plan…" />;
  if (state === 'auth') return <AuthNotice title="Sign in to view this plan." />;
  if (state === 'missing')
    return (
      <div>
        <BackLink />
        <p className="mt-6 font-serif text-[15px] italic text-[var(--color-ivory-dim)]">
          Plan not found.
        </p>
      </div>
    );
  if (state === 'error' || !plan) return <ErrorNotice />;

  const inp = plan.inputs || {};
  const cur = plan.current || plan.snapshot || {};
  const d = plan.delta;
  const rows: Array<[string, string]> = [
    [
      'Duty',
      eur(cur.dutyEur) + (cur.dutyRatePct != null ? ` (${cur.dutyRatePct}%)` : ''),
    ],
    ['Import VAT', eur(cur.vatEur)],
    ['Transport', eur(cur.transportEur)],
    ['Brokerage', eur(cur.brokerageEur)],
  ];

  return (
    <div className="max-w-[820px]">
      <BackLink />
      <PageHeader
        kicker={`Plan · ${(inp.originCountry || '?')} → ${(inp.destinationCountry || '?')}`}
        title={plan.label || inp.productCategory || plan.id}
        meta={
          <>
            {inp.hsCode ? `HS ${inp.hsCode}` : null}
            {plan.savedAt ? ` · saved ${String(plan.savedAt).slice(0, 10)}` : ''}
          </>
        }
      />

      {/* Headline metric — landed cost / shipment, today */}
      <section
        className="relative border border-[var(--color-navy-line)] bg-[var(--color-ink)] p-6 md:p-8"
      >
        <div className="font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
          Landed cost · per shipment · today
        </div>
        <div
          className="mt-3 font-serif text-[clamp(2.6rem,4vw+0.4rem,3.6rem)] leading-none tracking-[-0.024em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 550 }}
        >
          {eur(cur.perShipmentLandedTotal)}
        </div>
        {d && d.significant && d.landedDeltaPct != null && (
          <div
            className={`mt-4 font-mono text-[13.5px] font-medium tabular-nums ${
              d.landedDeltaPct >= 0
                ? 'text-[var(--color-critical)]'
                : 'text-[var(--color-positive)]'
            }`}
          >
            {d.landedDeltaPct >= 0 ? '▲' : '▼'} {Math.abs(d.landedDeltaPct)}% (
            {eur(d.landedDeltaEur)}) since saved
            {d.primaryDriver && (
              <span className="font-serif italic text-[var(--color-ivory-dim)]">
                {' '}
                · mostly {d.primaryDriver}
              </span>
            )}
            {typeof d.daysSinceSaved === 'number' && (
              <span className="font-serif italic text-[var(--color-ivory-mute)]">
                {' '}
                · {d.daysSinceSaved} day{d.daysSinceSaved === 1 ? '' : 's'} ago
              </span>
            )}
          </div>
        )}
      </section>

      {/* Cost breakdown */}
      <section className="mt-10">
        <SectionHead kicker="Cost breakdown" />
        <div className="border border-[var(--color-navy-line)]">
          {rows.map(([k, v], i) => (
            <div
              key={k}
              className={`flex items-baseline justify-between px-5 py-3.5 md:px-6 md:py-4 ${
                i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
              }`}
            >
              <span className="font-serif text-[14px] text-[var(--color-ivory-dim)]">{k}</span>
              <span className="font-mono text-[13.5px] font-medium tabular-nums text-[var(--color-ivory)]">
                {v}
              </span>
            </div>
          ))}
          <div className="flex items-baseline justify-between border-t border-[var(--color-navy-line)] bg-[var(--color-navy)]/30 px-5 py-3.5 md:px-6 md:py-4">
            <span className="font-serif text-[14px] text-[var(--color-ivory)]">Customs value</span>
            <span className="font-mono text-[13.5px] font-medium tabular-nums text-[var(--color-ivory)]">
              {eur(inp.customsValueEur)}
            </span>
          </div>
        </div>
      </section>

      {d && d.components && d.significant && (
        <RevisionDiff saved={plan.snapshot} current={cur} delta={d} />
      )}

      {repro && <ReproPanel r={repro} />}

      <p className="mt-10 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
        Recomputed against today&rsquo;s tariff, freight and FX data. Manage or re-run this
        plan on the{' '}
        <a className="underline-offset-4 hover:text-[var(--color-ivory)] hover:underline" href="/account/plans/">
          classic plans page
        </a>
        .
      </p>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/plans"
      className="inline-flex items-center gap-2 font-serif text-[13px] italic text-[var(--color-ivory-dim)] transition-colors duration-300 hover:text-[var(--color-ivory)]"
    >
      <span aria-hidden>←</span> Plans
    </Link>
  );
}

function SectionHead({ kicker }: { kicker: string }) {
  return (
    <div className="mb-4 flex items-baseline gap-3 border-b border-[var(--color-navy-line)] pb-3">
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

function ReproPanel({ r }: { r: Reproduction }) {
  const unchanged = r.status === 'data-unchanged';
  const drifted = r.status === 'data-drifted';
  const label = unchanged
    ? 'Reproducible — data unchanged'
    : drifted
    ? 'Data has drifted since you saved this'
    : r.status === 'no-snapshot-bound'
    ? 'No snapshot bound'
    : 'Original snapshot unavailable';
  const ruleColour = unchanged
    ? 'before:bg-[var(--color-positive)]'
    : drifted
    ? 'before:bg-[var(--color-warning)]'
    : 'before:bg-[var(--color-navy-line)]';
  const glyph = unchanged ? '✓' : drifted ? '◆' : '•';
  const glyphTone = unchanged
    ? 'text-[var(--color-positive)]'
    : drifted
    ? 'text-[var(--color-warning)]'
    : 'text-[var(--color-ivory-mute)]';

  return (
    <section
      className={`relative mt-10 bg-[var(--color-ink)] p-6 before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] md:p-7 ${ruleColour}`}
      style={{ border: '1px solid var(--color-navy-line)' }}
    >
      <SectionHead kicker="Reproducibility" />
      <div className="flex items-center gap-2">
        <span className={`text-[1.1rem] leading-none ${glyphTone}`}>{glyph}</span>
        <span
          className="font-serif text-[1rem] leading-tight tracking-[-0.014em] text-[var(--color-ivory)]"
          style={{ fontVariationSettings: "'SOFT' 35, 'opsz' 144", fontWeight: 550 }}
        >
          {label}
        </span>
      </div>
      {r.message && (
        <p className="mt-3 max-w-[60ch] text-[13.5px] leading-[1.6] text-[var(--color-ivory-dim)]">
          {r.message}
        </p>
      )}

      {drifted && r.landedReproduction && (
        <div className="mt-5 grid grid-cols-1 gap-px border border-[var(--color-navy-line)] bg-[var(--color-navy-line)] sm:grid-cols-2">
          <div className="flex flex-col gap-2 bg-[var(--color-ink)] p-5">
            <div className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
              Original (as saved)
            </div>
            <div
              className="font-serif text-[1.8rem] leading-none tracking-[-0.022em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 550 }}
            >
              {eur(r.landedReproduction.original.perShipmentLandedTotal)}
            </div>
          </div>
          <div className="flex flex-col gap-2 bg-[var(--color-ink)] p-5">
            <div className="font-serif text-[12px] italic text-[var(--color-ivory-mute)]">
              Recomputed today
            </div>
            <div
              className="font-serif text-[1.8rem] leading-none tracking-[-0.022em] text-[var(--color-ivory)]"
              style={{ fontVariationSettings: "'SOFT' 30, 'opsz' 144", fontWeight: 550 }}
            >
              {eur(r.landedReproduction.current?.perShipmentLandedTotal)}
            </div>
          </div>
        </div>
      )}

      {drifted && r.drift && r.drift.length > 0 && (
        <div className="mt-5 border border-[var(--color-navy-line)]">
          {r.drift.slice(0, 8).map((c, i) => (
            <div
              key={c.field}
              className={`flex items-baseline justify-between gap-3 px-4 py-2.5 text-[12.5px] ${
                i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
              }`}
            >
              <span className="font-serif italic text-[var(--color-ivory-dim)]">
                {c.label || c.field}
              </span>
              <span className="whitespace-nowrap font-mono font-medium tabular-nums text-[var(--color-ivory)]">
                {fmtVal(c.from)} → {fmtVal(c.to)}
              </span>
            </div>
          ))}
          {r.drift.length > 8 && (
            <div className="border-t border-[var(--color-navy-line)] px-4 py-2.5 font-serif text-[12.5px] italic text-[var(--color-ivory-mute)]">
              + {r.drift.length - 8} more
            </div>
          )}
        </div>
      )}

      {r.storedSnapshotId && (
        <div className="mt-5 font-mono text-[11px] tracking-tight text-[var(--color-ivory-mute)]">
          snapshot {r.storedSnapshotId}
          {r.currentSnapshotId && r.currentSnapshotId !== r.storedSnapshotId
            ? ` → ${r.currentSnapshotId}`
            : ''}
        </div>
      )}
    </section>
  );
}

type CostKey = 'dutyEur' | 'vatEur' | 'transportEur' | 'brokerageEur';
const COMPONENT_LABELS: Record<CostKey, string> = {
  dutyEur: 'Duty',
  vatEur: 'Import VAT',
  transportEur: 'Transport',
  brokerageEur: 'Brokerage',
};

function RevisionDiff({
  saved,
  current,
  delta,
}: {
  saved?: {
    dutyEur?: number;
    vatEur?: number;
    transportEur?: number;
    brokerageEur?: number;
  } | null;
  current?: {
    dutyEur?: number;
    vatEur?: number;
    transportEur?: number;
    brokerageEur?: number;
  } | null;
  delta: NonNullable<SavedPlan['delta']>;
}) {
  const movedKeys = (Object.keys(COMPONENT_LABELS) as CostKey[]).filter(
    (k) => Math.abs(delta.components?.[k] ?? 0) >= 1,
  );
  if (!movedKeys.length) return null;
  return (
    <section
      className="relative mt-10 bg-[var(--color-ink)] p-6 before:absolute before:left-0 before:top-0 before:h-full before:w-[2px] before:bg-[var(--color-warning)] md:p-7"
      style={{ border: '1px solid var(--color-navy-line)' }}
    >
      <SectionHead kicker="What changed since you saved" />
      <div className="border border-[var(--color-navy-line)]">
        <div className="grid grid-cols-4 gap-2 border-b border-[var(--color-navy-line)] bg-[var(--color-navy)]/30 px-4 py-2 font-mono text-[10.5px] uppercase tracking-tight text-[var(--color-ivory-mute)]">
          <span>Line</span>
          <span className="text-right">Saved</span>
          <span className="text-right">Today</span>
          <span className="text-right">Δ</span>
        </div>
        {movedKeys.map((k, i) => {
          const s = saved?.[k];
          const c = current?.[k];
          const diff = delta.components?.[k] ?? 0;
          const up = diff >= 0;
          return (
            <div
              key={k}
              className={`grid grid-cols-4 items-baseline gap-2 px-4 py-2.5 text-[12.5px] ${
                i > 0 ? 'border-t border-[var(--color-navy-line)]' : ''
              }`}
            >
              <span className="font-serif text-[var(--color-ivory-dim)]">{COMPONENT_LABELS[k]}</span>
              <span className="text-right font-mono font-medium tabular-nums text-[var(--color-ivory-mute)]">
                {eur(s)}
              </span>
              <span className="text-right font-mono font-medium tabular-nums text-[var(--color-ivory)]">
                {eur(c)}
              </span>
              <span
                className={`text-right font-mono font-medium tabular-nums ${
                  up ? 'text-[var(--color-critical)]' : 'text-[var(--color-positive)]'
                }`}
              >
                {up ? '+' : ''}
                {eur(diff)}
              </span>
            </div>
          );
        })}
      </div>
      {typeof delta.dutyRateDelta === 'number' && Math.abs(delta.dutyRateDelta) >= 0.1 && (
        <p className="mt-4 max-w-[60ch] text-[13px] leading-[1.6] text-[var(--color-ivory-dim)]">
          Duty rate moved{' '}
          <b
            className={
              delta.dutyRateDelta >= 0
                ? 'font-mono tabular-nums text-[var(--color-critical)]'
                : 'font-mono tabular-nums text-[var(--color-positive)]'
            }
          >
            {delta.dutyRateDelta >= 0 ? '+' : ''}
            {delta.dutyRateDelta.toFixed(1)}pp
          </b>
          {delta.primaryDriver && (
            <>
              {' '}
              (driver: <em>{delta.primaryDriver}</em>)
            </>
          )}
          .
        </p>
      )}
    </section>
  );
}
