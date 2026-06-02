'use client';

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';

// Live audit-chain anchor widget. Pulls /api/audit-anchor and renders
// the current { chainHead, chainLength, asOf, genesis } as a monospace
// receipt. The chain head is the sha256 over a PII-free projection;
// publishing it is safe and is the "blockchain receipt" of the
// tamper-evident chain.
//
// Loading state: skeleton lines that pulse in (no spinner — that would
// feel like a regression in a flagship motion-system page).
// Failure state: a polite "anchor temporarily unavailable" line.
//
// Refresh: every 5 minutes (anchor changes infrequently; the underlying
// chain only updates on each event write, which is a few times per
// minute in production — polling more often is wasteful).

type Anchor = {
  ok: boolean;
  asOf?: string;
  chainHead?: string;
  chainLength?: number;
  genesis?: string;
};

export function AuditAnchorWidget() {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch('/api/audit-anchor', { cache: 'no-store' });
        if (!res.ok) throw new Error('http ' + res.status);
        const j = await res.json();
        if (alive) {
          if (j && j.ok) {
            setAnchor(j);
            setFailed(false);
          } else {
            setFailed(true);
          }
        }
      } catch {
        if (alive) setFailed(true);
      }
    }
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4 }}
      className="border border-[var(--color-navy-line)] bg-[var(--color-ink)]/40 p-4 font-mono text-[12px] leading-[1.65] text-[var(--color-ivory-dim)]"
    >
      {anchor ? (
        <>
          <div className="text-[var(--color-ivory-mute)]">$ curl https://orcatradegroup.com/api/audit-anchor</div>
          <div className="mt-2 break-all">
            <span className="text-[var(--color-ivory-mute)]">chainHead:</span>{' '}
            <span className="text-[var(--color-ivory)]">{anchor.chainHead}</span>
          </div>
          <div className="mt-1">
            <span className="text-[var(--color-ivory-mute)]">chainLength:</span>{' '}
            <span className="text-[var(--color-ivory)]">{anchor.chainLength}</span>
          </div>
          <div className="mt-1">
            <span className="text-[var(--color-ivory-mute)]">asOf:</span>{' '}
            <span className="text-[var(--color-ivory)]">{anchor.asOf}</span>
          </div>
          <div className="mt-1 break-all">
            <span className="text-[var(--color-ivory-mute)]">genesis:</span>{' '}
            <span className="text-[var(--color-ivory)]">{anchor.genesis}</span>
          </div>
        </>
      ) : failed ? (
        <div className="text-[var(--color-ivory-mute)]">(anchor temporarily unavailable)</div>
      ) : (
        <div className="space-y-1.5">
          <div className="h-3 w-2/3 animate-pulse bg-[var(--color-navy-line)]" />
          <div className="h-3 w-1/3 animate-pulse bg-[var(--color-navy-line)]" />
          <div className="h-3 w-1/2 animate-pulse bg-[var(--color-navy-line)]" />
        </div>
      )}
    </motion.div>
  );
}
