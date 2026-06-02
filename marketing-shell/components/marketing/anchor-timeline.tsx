'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

// Tamper-evident audit-chain rolling history. Fetches
// /api/audit-anchor/history and renders newest-first. The most recent
// row wears a "current" pill and an ivory border to anchor a
// procurement reviewer's eye before scanning historical rows.
//
// Timestamps render as 'YYYY-MM-DD HH:mm UTC' — global facts, viewer
// timezone deliberately ignored so two pinned receipts compare cleanly.

interface Snapshot {
  savedAt: string;
  chainHead: string;
  chainLength: number;
  asOf: string;
  genesis: string;
}

interface HistoryResponse {
  ok: boolean;
  snapshots?: Snapshot[];
}

function fmtTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  return `${String(iso).slice(0, 10)} ${String(iso).slice(11, 16)} UTC`;
}

type State = 'loading' | 'empty' | 'error' | 'ready';

export function AnchorTimeline() {
  const [state, setState] = useState<State>('loading');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/audit-anchor/history', { credentials: 'omit' });
        if (!res.ok) throw new Error('history HTTP ' + res.status);
        const body: HistoryResponse = await res.json();
        if (!alive) return;
        if (!body || body.ok === false) throw new Error('history not ok');
        const arr = Array.isArray(body.snapshots) ? body.snapshots : [];
        if (arr.length === 0) {
          setState('empty');
          return;
        }
        setSnapshots(arr);
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

  return (
    <div>
      <AnimatePresence mode="wait">
        {state === 'loading' && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-3"
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/30"
              />
            ))}
          </motion.div>
        )}

        {state === 'empty' && (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/25 p-6 text-[14px] leading-[1.65] text-[var(--color-ivory-dim)]"
          >
            <strong className="text-[var(--color-ivory)]">No snapshots yet.</strong>{' '}
            The first snapshot is published by the nightly cron at 02:00 UTC. Check back tomorrow.
          </motion.div>
        )}

        {state === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/[0.06] p-6 text-[14px] leading-[1.65] text-[var(--color-ivory-dim)]"
          >
            <strong className="text-[var(--color-critical)]">Could not load the anchor history.</strong>{' '}
            The /api/audit-anchor/history endpoint did not respond. The current anchor is still queryable at <code className="font-mono text-[var(--color-ivory)]">/api/audit-anchor</code>.
          </motion.div>
        )}

        {state === 'ready' && (
          <motion.ol
            key="timeline"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            {snapshots.map((s, i) => {
              const isNewest = i === 0;
              return (
                <motion.li
                  key={s.savedAt + s.chainHead}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                  className={cn(
                    'border p-5',
                    isNewest
                      ? 'border-[var(--color-ivory)]/40 bg-[var(--color-navy-soft)]/45'
                      : 'border-[var(--color-navy-line)] bg-[var(--color-navy-soft)]/25',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-[12px] uppercase tracking-[0.12em] text-[var(--color-ivory-dim)]">
                      {fmtTimestamp(s.savedAt)}
                    </span>
                    {isNewest && (
                      <span className="border border-[var(--color-ivory)]/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivory)]">
                        Current
                      </span>
                    )}
                  </div>
                  <div className="mt-3 break-all font-mono text-[12px] leading-[1.5] text-[var(--color-ivory)]">
                    {s.chainHead}
                  </div>
                  <div className="mt-2 font-mono text-[11px] leading-[1.55] text-[var(--color-ivory-mute)]">
                    <span className="text-[var(--color-ivory-dim)]">chainLength</span>{' '}
                    <span className="text-[var(--color-ivory)]">{s.chainLength}</span> ·{' '}
                    <span className="text-[var(--color-ivory-dim)]">asOf</span>{' '}
                    <span className="text-[var(--color-ivory)]">{fmtTimestamp(s.asOf)}</span> ·{' '}
                    <span className="text-[var(--color-ivory-dim)]">genesis</span>{' '}
                    <span className="text-[var(--color-ivory)]">{s.genesis}</span>
                  </div>
                </motion.li>
              );
            })}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}
