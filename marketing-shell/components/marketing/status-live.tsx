'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

// Live status dashboard for /status/. Three coordinated widgets:
//   1. Overall health pill (ok / degraded / down) — pulses softly
//   2. Per-subsystem cards from /api/health
//   3. Session-uptime sparkline (sessionStorage — per-visitor)
//
// Polls /api/health every 30s. Honours prefers-reduced-motion by
// skipping the pulse animation. Sub-second probe target on /api/health.

type SubsystemStatus = 'ok' | 'degraded' | 'down';

interface Subsystem {
  status: SubsystemStatus;
  mode?: string;
  latencyMs?: number;
  configured?: boolean;
  ageHours?: number;
  lastWarmAt?: string;
  circuit?: string;
  reason?: string;
}

interface HealthResponse {
  ts: string;
  status: SubsystemStatus;
  version?: string;
  subsystems: Record<string, Subsystem>;
}

const SUBSYSTEM_LABELS: Record<string, string> = {
  kv: 'Data store (Upstash KV)',
  postgres: 'Postgres (Neon)',
  taric: 'EU TARIC cache',
  resend: 'Email delivery (Resend)',
  stripe: 'Billing (Stripe)',
  anthropic: 'AI agents (Anthropic)',
  sentry: 'Error reporting (Sentry)',
};

const OVERALL_LABEL: Record<SubsystemStatus, string> = {
  ok: 'All systems operational',
  degraded: 'Partial degradation',
  down: 'Major incident — platform unavailable',
};

const STATUS_CLASS: Record<SubsystemStatus, string> = {
  ok: 'border-[var(--color-positive)]/45 bg-[var(--color-positive)]/[0.06] text-[var(--color-positive)]',
  degraded: 'border-[var(--color-warning)]/45 bg-[var(--color-warning)]/[0.06] text-[var(--color-warning)]',
  down: 'border-[var(--color-critical)]/55 bg-[var(--color-critical)]/[0.08] text-[var(--color-critical)]',
};

const UPTIME_STORAGE_KEY = 'orcatrade.status.uptimeSamples';
const UPTIME_MAX_SAMPLES = 60;

interface Sample {
  ts: number;
  status: SubsystemStatus;
}

function loadSamples(): Sample[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(UPTIME_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSamples(samples: Sample[]) {
  try {
    sessionStorage.setItem(UPTIME_STORAGE_KEY, JSON.stringify(samples));
  } catch {
    /* quota / private mode — best effort */
  }
}

export function StatusLive() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [lastChecked, setLastChecked] = useState<string>('—');
  const [samples, setSamples] = useState<Sample[]>([]);

  useEffect(() => {
    setSamples(loadSamples());
  }, []);

  useEffect(() => {
    let alive = true;
    async function refresh() {
      const t0 = Date.now();
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const body: HealthResponse = await res.json();
        if (!alive) return;
        setData(body);
        setFailed(false);
        const elapsed = Date.now() - t0;
        setLastChecked(`${new Date(body.ts).toLocaleTimeString()} · ${elapsed} ms`);
        setSamples((prev) => {
          const next = [...prev, { ts: Date.now(), status: body.status }].slice(
            -UPTIME_MAX_SAMPLES,
          );
          saveSamples(next);
          return next;
        });
      } catch {
        if (!alive) return;
        setFailed(true);
        setLastChecked(`Failed at ${new Date().toLocaleTimeString()}`);
        setSamples((prev) => {
          const next = [...prev, { ts: Date.now(), status: 'down' as SubsystemStatus }].slice(
            -UPTIME_MAX_SAMPLES,
          );
          saveSamples(next);
          return next;
        });
      }
    }
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const overall: SubsystemStatus = failed ? 'down' : data?.status ?? 'ok';
  const okCount = samples.filter((s) => s.status === 'ok').length;
  const pct = samples.length > 0 ? ((okCount / samples.length) * 100).toFixed(samples.length >= 10 ? 1 : 0) : null;

  return (
    <div className="flex flex-col gap-10">
      {/* Overall health pill */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className={cn(
          'flex flex-wrap items-center justify-between gap-4 border px-5 py-4',
          STATUS_CLASS[overall],
        )}
      >
        <div className="flex items-center gap-3">
          <span className="relative inline-flex">
            <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-current opacity-40 motion-reduce:hidden" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-current" />
          </span>
          <span className="font-serif text-[18px] leading-[1.1] text-[var(--color-ivory)]">
            {failed ? 'Status page cannot reach the platform' : OVERALL_LABEL[overall]}
          </span>
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ivory-mute)]">
          {lastChecked}
        </div>
      </motion.div>

      {/* Subsystem cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data &&
          Object.entries(data.subsystems).map(([key, sub], i) => {
            const label = SUBSYSTEM_LABELS[key] || key;
            const lines: string[] = [];
            if (key === 'kv' && sub.mode) {
              lines.push(
                `mode: ${sub.mode}${sub.latencyMs != null ? ` · ${sub.latencyMs} ms` : ''}`,
              );
            }
            if (key === 'taric') {
              lines.push(
                sub.lastWarmAt && sub.ageHours != null
                  ? `last warmed: ${sub.ageHours < 1 ? `${Math.round(sub.ageHours * 60)} min ago` : sub.ageHours < 24 ? `${sub.ageHours.toFixed(1)} h ago` : `${Math.round(sub.ageHours / 24)} d ago`}`
                  : 'never warmed',
              );
            }
            if ((key === 'resend' || key === 'stripe' || key === 'anthropic') && sub.configured != null) {
              lines.push(sub.configured ? 'configured' : 'not configured');
            }
            if (sub.circuit && sub.circuit !== 'closed') {
              lines.push(`circuit: ${sub.circuit}`);
            }
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className="border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-serif text-[16px] leading-[1.2] text-[var(--color-ivory)]">
                    {label}
                  </span>
                  <span
                    className={cn(
                      'border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]',
                      STATUS_CLASS[sub.status],
                    )}
                  >
                    {sub.status}
                  </span>
                </div>
                {lines.length > 0 && (
                  <div className="mt-2 font-mono text-[11px] leading-[1.55] text-[var(--color-ivory-mute)]">
                    {lines.join(' · ')}
                  </div>
                )}
                {sub.reason && (
                  <div className="mt-2 text-[12px] leading-[1.5] text-[var(--color-ivory-dim)]">
                    {sub.reason}
                  </div>
                )}
              </motion.div>
            );
          })}
        {!data && !failed && (
          <div className="col-span-full grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30"
              />
            ))}
          </div>
        )}
      </div>

      {/* Session uptime sparkline */}
      <div className="border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/25 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-serif text-[18px] leading-[1.2] text-[var(--color-ivory)]">
            This session&rsquo;s uptime
          </h3>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--color-ivory-mute)]">
            {samples.length} sample{samples.length === 1 ? '' : 's'}
          </span>
        </div>
        <p className="mt-2 max-w-[68ch] text-[13px] leading-[1.55] text-[var(--color-ivory-dim)]">
          Each tick is a successful <code className="font-mono text-[12px] text-[var(--color-ivory)]">/api/health</code> probe from this browser, thirty seconds apart. Per-visitor view — what you see is verifiably real, but the window is your session. For cross-visitor evidence of continuous operation, see the <a href="/trust/anchors/" className="text-[var(--color-ivory)] underline-offset-2 hover:underline">tamper-evident audit-chain history</a> — a fresh anchor is published nightly by an independent GitHub-hosted cron job; gaps would surface a missed day.
        </p>
        <div className="mt-4 flex h-8 items-stretch gap-[2px]">
          {[
            ...new Array(Math.max(0, UPTIME_MAX_SAMPLES - samples.length)).fill(null),
            ...samples,
          ].map((s, i) => (
            <div
              key={i}
              className={cn(
                'flex-1 min-w-[3px] rounded-[1px] transition-colors',
                !s
                  ? 'bg-[var(--color-navy-line)]'
                  : s.status === 'ok'
                    ? 'bg-gradient-to-b from-[var(--color-positive)]/85 to-[var(--color-positive)]/55'
                    : s.status === 'degraded'
                      ? 'bg-gradient-to-b from-[var(--color-warning)]/85 to-[var(--color-warning)]/55'
                      : 'bg-gradient-to-b from-[var(--color-critical)]/90 to-[var(--color-critical)]/55',
              )}
              title={s ? `${new Date(s.ts).toLocaleTimeString()} · ${s.status}` : undefined}
            />
          ))}
        </div>
        <div className="mt-3 font-mono text-[12px] text-[var(--color-ivory-mute)]">
          {samples.length === 0
            ? 'No samples yet — wait 30 seconds.'
            : `${okCount} ok / ${samples.length} samples · ${pct}% this session`}
        </div>
      </div>
    </div>
  );
}
