'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

// Certifications & compliance roadmap table.
// Honest current state: Live / Ready / Queued. Used on /trust/.
//
// Status semantics:
//   live   — in place today, evidence in the repository
//   ready  — scoping / scope-brief done, pending engagement
//   queued — planned, no commitment date yet
//
// No "Type II certified" badge anywhere — this is the honesty layer
// that prevents marketing-shine drift. The contract test on the legacy
// trust page enforced this; the same discipline applies here.

export type CertStatus = 'live' | 'ready' | 'queued';

export interface CertRow {
  standard: string;
  status: CertStatus;
  target?: string;
}

const STATUS_LABEL: Record<CertStatus, string> = {
  live: 'Live',
  ready: 'Ready',
  queued: 'Queued',
};

const STATUS_CLASS: Record<CertStatus, string> = {
  live: 'text-[var(--color-positive)] border-[var(--color-positive)]/40 bg-[var(--color-positive)]/8',
  ready: 'text-[var(--color-ivory)] border-[var(--color-ivory)]/40 bg-[var(--color-ivory)]/8',
  queued: 'text-[var(--color-ivory-mute)] border-[var(--color-ivory-mute)]/40 bg-[var(--color-ivory)]/3',
};

export function CertificationsTable({
  rows,
  className,
}: {
  rows: CertRow[];
  className?: string;
}) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left font-mono text-[13px]">
        <thead>
          <tr className="border-b border-[var(--color-navy-line)]">
            <th className="px-3 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ivory-mute)]">
              Standard / framework
            </th>
            <th className="px-3 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ivory-mute)]">
              Status
            </th>
            <th className="hidden px-3 py-3 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ivory-mute)] sm:table-cell">
              Target
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <motion.tr
              key={r.standard}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.35, delay: i * 0.03 }}
              className="border-b border-[var(--color-navy-line)] last:border-0 hover:bg-[var(--color-navy-soft)]/40"
            >
              <td className="px-3 py-3 text-[var(--color-ivory)]">{r.standard}</td>
              <td className="px-3 py-3">
                <span
                  className={cn(
                    'inline-block border px-2 py-0.5 text-[10px] uppercase tracking-[0.1em]',
                    STATUS_CLASS[r.status],
                  )}
                >
                  {STATUS_LABEL[r.status]}
                </span>
              </td>
              <td className="hidden px-3 py-3 text-[var(--color-ivory-dim)] sm:table-cell">
                {r.target ?? '—'}
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
