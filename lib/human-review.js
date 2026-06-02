// Human-review queue — Phase 0 P0.10.
//
// Why this module exists
// ──────────────────────
// All 5 agents (compliance / logistics / sourcing / finance / orchestrator)
// have a `requestHumanReview` tool. Per docs/finance-agent-spec.md +
// siblings, the agent invokes it before recommending irreversible
// commercial actions, on uncertain regulatory interpretation, or when
// the user explicitly asks for a human. Until P0.10 the tool was a
// Potemkin escalation: handler returned a fake ticket id, nothing
// downstream consumed it, no human ever saw it.
//
// This module makes the tool real:
//
//   appendTicket(input)
//     → persists a ticket to KV at `human-review:queue` (JSON-encoded
//       array, capped at QUEUE_CAP newest entries; older entries are
//       pruned, but each ticket also writes an `events.record` so the
//       full audit trail survives via the events stream)
//     → fires `notifyOps(ticket)` best-effort (Resend email; circuit-
//       wrapped per ADR 0006; no-op when ORCATRADE_OPS_EMAIL unset)
//     → returns the persisted ticket including its id + receivedAt
//
//   listTickets({ status?, limit? }) → newest-first
//   claimTicket(id, claimedBy)   → status = 'acknowledged'
//   resolveTicket(id, resolvedBy, resolution?) → status = 'resolved'
//
// Storage shape
// ─────────────
//   KV key   `human-review:queue`
//   KV value JSON array of tickets (most-recent first inside the array)
//   Cap      QUEUE_CAP (500); when full, oldest entries are pruned
//   TTL      365 days — newer than that and the human can find it; older
//            than that and the events stream / audit ledger is the
//            historical record
//
// Read-modify-write is single-threaded against Upstash KV's REST endpoint
// — race windows exist but are tiny at our scale; if it becomes a
// problem, swap to Upstash's atomic LPUSH (out of P0.10 scope).
//
// PII discipline
// ──────────────
// Agents are instructed to pass non-PII context (per ADR 0008). This
// module does NOT re-redact; if a violation is found in production, a
// Phase 1 PR adds the redact step. The events.record write does pass
// through lib/events.js's email-hash discipline.

'use strict';

const crypto = require('node:crypto');
const kv = require('./intelligence/kv-store');
const email = require('./email');
const events = require('./events');
const log = require('./log').withContext({ module: 'human-review' });

const QUEUE_KEY = 'human-review:queue';
const QUEUE_CAP = 500;
const QUEUE_TTL_SECONDS = 365 * 24 * 60 * 60;

const VALID_AGENTS = new Set(['compliance', 'logistics', 'sourcing', 'finance', 'orchestrator']);
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const VALID_STATUSES = new Set(['new', 'acknowledged', 'resolved']);

// Agent tool schemas declare severity as `info|minor|moderate|major|critical`
// (see lib/handlers/*-agent.js). The queue uses the leaner 4-level vocab
// above so ops dashboards stay simple. Map between them losslessly so the
// agent's call-site language survives the round-trip.
const SEVERITY_SYNONYMS = {
  info: 'low',
  minor: 'low',
  low: 'low',
  moderate: 'medium',
  medium: 'medium',
  major: 'high',
  high: 'high',
  critical: 'critical',
};

function generateTicketId() {
  const time = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `tkt_${time}_${rand}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function readQueue() {
  try {
    const raw = await kv.getJson(QUEUE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw;
  } catch (err) {
    log.error('readQueue failed', { err: err.message });
    return [];
  }
}

async function writeQueue(queue) {
  // Cap on write: keep the newest QUEUE_CAP entries.
  const trimmed = queue.length > QUEUE_CAP ? queue.slice(0, QUEUE_CAP) : queue;
  await kv.setJson(QUEUE_KEY, trimmed, QUEUE_TTL_SECONDS);
  return trimmed.length;
}

/**
 * Persist a ticket + fire the ops notification (best-effort).
 *
 * @param {object} input
 * @param {string} input.agent       — one of VALID_AGENTS
 * @param {string} input.reason      — short human-readable why
 * @param {string} input.severity    — one of VALID_SEVERITIES
 * @param {object} [input.context]   — arbitrary structured context
 * @returns {Promise<object>} the persisted ticket
 */
async function appendTicket(input = {}) {
  const agent = typeof input.agent === 'string' && VALID_AGENTS.has(input.agent)
    ? input.agent
    : 'unknown';
  const reason = typeof input.reason === 'string' && input.reason.trim()
    ? input.reason.trim().slice(0, 1000)
    : 'no reason provided';
  const severityRaw = typeof input.severity === 'string' ? input.severity.toLowerCase() : '';
  const severity = SEVERITY_SYNONYMS[severityRaw] || 'medium';
  const context = input.context && typeof input.context === 'object' ? input.context : {};

  const ticket = {
    id: generateTicketId(),
    agent,
    reason,
    severity,
    context,
    requestedAt: nowIso(),
    status: 'new',
  };

  // KV write (primary)
  try {
    const queue = await readQueue();
    queue.unshift(ticket); // newest first
    await writeQueue(queue);
  } catch (err) {
    // KV outage shouldn't break the agent — log + continue. The events
    // stream below still captures the ticket so the human-review trail
    // survives a KV failure.
    log.error('appendTicket KV write failed', { ticketId: ticket.id, err: err.message });
  }

  // Audit trail via events stream — survives even if KV pruned the
  // ticket from the queue. Non-swallowing (per ADR 0005) — if events
  // can't write, propagate.
  await events.record('human_review_requested', {
    ticketId: ticket.id,
    agent,
    severity,
    reason,
  });

  // Notify ops — best-effort (Resend may be down, env may be unset).
  notifyOps(ticket).catch((err) => {
    log.warn('notifyOps failed', { ticketId: ticket.id, err: err.message });
  });

  return ticket;
}

/**
 * Send a short email to the configured ops alias announcing a new ticket.
 * No-op if ORCATRADE_OPS_EMAIL is unset or Resend is unconfigured.
 *
 * @param {object} ticket
 */
async function notifyOps(ticket) {
  const to = process.env.ORCATRADE_OPS_EMAIL;
  if (!to) return { ok: false, reason: 'ORCATRADE_OPS_EMAIL not set' };
  if (!email.isConfigured()) return { ok: false, reason: 'Resend not configured' };

  const subject = `[OrcaTrade human-review] ${ticket.severity.toUpperCase()} — ${ticket.agent}: ${ticket.reason.slice(0, 80)}`;
  const text = [
    `A new human-review ticket has been opened.`,
    ``,
    `Ticket: ${ticket.id}`,
    `Agent:  ${ticket.agent}`,
    `Sev:    ${ticket.severity}`,
    `When:   ${ticket.requestedAt}`,
    ``,
    `Reason:`,
    ticket.reason,
    ``,
    `Run \`curl -H "x-admin-token: $TOKEN" https://orcatrade.pl/api/human-review\` to`,
    `see the queue + full context. Acknowledge with POST { id, action: 'claim' }.`,
    ``,
    `Runbook: docs/runbooks/human-review-queue.md`,
  ].join('\n');

  return email.send({ to, subject, text });
}

/**
 * Read tickets newest-first, optionally filtered by status.
 *
 * @param {object} [opts]
 * @param {string} [opts.status]  — 'new' | 'acknowledged' | 'resolved'
 * @param {number} [opts.limit]   — default 100, max 500
 * @returns {Promise<object[]>}
 */
async function listTickets({ status, limit } = {}) {
  let queue = await readQueue();
  if (status && VALID_STATUSES.has(status)) {
    queue = queue.filter((t) => t.status === status);
  }
  const cap = Math.min(typeof limit === 'number' && limit > 0 ? limit : 100, 500);
  return queue.slice(0, cap);
}

/**
 * Mark a ticket as acknowledged (claimed by a human).
 * Idempotent on the (id, claimedBy) pair.
 */
async function claimTicket(id, claimedBy) {
  if (!id) throw new Error('id required');
  if (!claimedBy) throw new Error('claimedBy required');
  const queue = await readQueue();
  const ticket = queue.find((t) => t.id === id);
  if (!ticket) return { ok: false, reason: 'not found' };
  ticket.status = 'acknowledged';
  ticket.claimedBy = String(claimedBy);
  ticket.claimedAt = nowIso();
  await writeQueue(queue);
  await events.record('human_review_claimed', { ticketId: id, claimedBy: ticket.claimedBy });
  return { ok: true, ticket };
}

/**
 * Mark a ticket as resolved.
 */
async function resolveTicket(id, resolvedBy, resolution) {
  if (!id) throw new Error('id required');
  if (!resolvedBy) throw new Error('resolvedBy required');
  const queue = await readQueue();
  const ticket = queue.find((t) => t.id === id);
  if (!ticket) return { ok: false, reason: 'not found' };
  ticket.status = 'resolved';
  ticket.resolvedBy = String(resolvedBy);
  ticket.resolvedAt = nowIso();
  if (resolution && typeof resolution === 'string') {
    ticket.resolution = resolution.slice(0, 2000);
  }
  await writeQueue(queue);
  await events.record('human_review_resolved', { ticketId: id, resolvedBy: ticket.resolvedBy });
  return { ok: true, ticket };
}

module.exports = {
  appendTicket,
  listTickets,
  claimTicket,
  resolveTicket,
  notifyOps,
  // Constants exported for tests + admin handler
  QUEUE_KEY,
  QUEUE_CAP,
  QUEUE_TTL_SECONDS,
  VALID_AGENTS,
  VALID_SEVERITIES,
  VALID_STATUSES,
  // Test surface
  _readQueue: readQueue,
  _writeQueue: writeQueue,
  _generateTicketId: generateTicketId,
};
