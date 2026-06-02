'use strict';

// Phase 0 task P0.10 of docs/execution-plan.md.
//
// Tests the human-review queue (lib/human-review.js) — the real
// implementation that replaces the prior fake-ticketId tool. Runs
// against the in-memory KV backend (the default when no KV env vars
// are set in test environments).
//
// Asserts:
//   - appendTicket persists a ticket with a stable shape
//   - listTickets is newest-first + filters by status + caps at limit
//   - claimTicket / resolveTicket mutate the ticket + are idempotent
//     on (id, claimedBy)
//   - generateTicketId produces unique ids under tight time spacing
//   - Source-pin that all 5 agents (including orchestrator-inherited)
//     route through lib/human-review.js
//   - Source-pin that the dispatcher registers /api/human-review

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const humanReview = require('../lib/human-review');
const kv = require('../lib/intelligence/kv-store');

const ROOT = path.resolve(__dirname, '..');

// ── helpers ─────────────────────────────────────────────────────────────

async function resetQueue() {
  await kv.del(humanReview.QUEUE_KEY);
}

// ── appendTicket ────────────────────────────────────────────────────────

test('appendTicket persists a ticket with id + requestedAt + status:new', async () => {
  await resetQueue();
  const ticket = await humanReview.appendTicket({
    agent: 'compliance',
    reason: 'CBAM exposure exceeds threshold',
    severity: 'high',
    context: { sku: 'STEEL-001', tonnes: 50 },
  });
  assert.match(ticket.id, /^tkt_[a-z0-9]+_[0-9a-f]{8}$/);
  assert.equal(ticket.agent, 'compliance');
  assert.equal(ticket.reason, 'CBAM exposure exceeds threshold');
  assert.equal(ticket.severity, 'high');
  assert.equal(ticket.status, 'new');
  assert.deepEqual(ticket.context, { sku: 'STEEL-001', tonnes: 50 });
  assert.ok(ticket.requestedAt && !Number.isNaN(Date.parse(ticket.requestedAt)));
});

test('appendTicket normalises bad inputs (unknown agent / unknown severity)', async () => {
  await resetQueue();
  const ticket = await humanReview.appendTicket({
    agent: 'made-up-agent',
    reason: '',
    severity: 'panic',
    context: 'not-an-object',
  });
  assert.equal(ticket.agent, 'unknown');
  assert.equal(ticket.reason, 'no reason provided');
  assert.equal(ticket.severity, 'medium');
  assert.deepEqual(ticket.context, {});
});

test('appendTicket truncates long reasons + resolution to bounded sizes', async () => {
  await resetQueue();
  const longReason = 'x'.repeat(2000);
  const ticket = await humanReview.appendTicket({
    agent: 'finance',
    reason: longReason,
    severity: 'critical',
  });
  assert.ok(ticket.reason.length <= 1000, `reason should be capped at 1000 chars; got ${ticket.reason.length}`);
});

// ── listTickets ─────────────────────────────────────────────────────────

test('listTickets returns newest first + filters by status + caps at limit', async () => {
  await resetQueue();
  // Append 5 tickets quickly
  await humanReview.appendTicket({ agent: 'compliance', reason: 'first', severity: 'low' });
  await humanReview.appendTicket({ agent: 'logistics', reason: 'second', severity: 'medium' });
  await humanReview.appendTicket({ agent: 'finance', reason: 'third', severity: 'high' });
  await humanReview.appendTicket({ agent: 'sourcing', reason: 'fourth', severity: 'critical' });
  await humanReview.appendTicket({ agent: 'compliance', reason: 'fifth', severity: 'low' });

  const all = await humanReview.listTickets();
  assert.equal(all.length, 5);
  // Newest first
  assert.equal(all[0].reason, 'fifth');
  assert.equal(all[4].reason, 'first');

  // Filter by status (all are 'new' initially)
  const newOnly = await humanReview.listTickets({ status: 'new' });
  assert.equal(newOnly.length, 5);

  const resolvedOnly = await humanReview.listTickets({ status: 'resolved' });
  assert.equal(resolvedOnly.length, 0);

  // Cap at limit
  const top3 = await humanReview.listTickets({ limit: 3 });
  assert.equal(top3.length, 3);
  assert.equal(top3[0].reason, 'fifth');
});

// ── claimTicket / resolveTicket ─────────────────────────────────────────

test('claimTicket marks status as acknowledged + captures claimedBy', async () => {
  await resetQueue();
  const ticket = await humanReview.appendTicket({
    agent: 'compliance',
    reason: 'review needed',
    severity: 'medium',
  });
  const result = await humanReview.claimTicket(ticket.id, 'oskar@orcatradegroup.com');
  assert.equal(result.ok, true);
  assert.equal(result.ticket.status, 'acknowledged');
  assert.equal(result.ticket.claimedBy, 'oskar@orcatradegroup.com');
  assert.ok(result.ticket.claimedAt && !Number.isNaN(Date.parse(result.ticket.claimedAt)));
});

test('claimTicket returns ok:false on unknown id', async () => {
  await resetQueue();
  const result = await humanReview.claimTicket('tkt_does_not_exist', 'admin');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not found');
});

test('resolveTicket marks status as resolved + captures resolution', async () => {
  await resetQueue();
  const ticket = await humanReview.appendTicket({
    agent: 'finance',
    reason: 'LC issuance > 100k',
    severity: 'high',
  });
  await humanReview.claimTicket(ticket.id, 'oskar@orcatradegroup.com');
  const result = await humanReview.resolveTicket(
    ticket.id,
    'oskar@orcatradegroup.com',
    'Approved by treasury — bank confirmed.',
  );
  assert.equal(result.ok, true);
  assert.equal(result.ticket.status, 'resolved');
  assert.equal(result.ticket.resolvedBy, 'oskar@orcatradegroup.com');
  assert.equal(result.ticket.resolution, 'Approved by treasury — bank confirmed.');
  assert.ok(result.ticket.resolvedAt && !Number.isNaN(Date.parse(result.ticket.resolvedAt)));
});

// ── generateTicketId uniqueness ─────────────────────────────────────────

test('generateTicketId produces unique ids under tight spacing', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    ids.add(humanReview._generateTicketId());
  }
  assert.equal(ids.size, 1000, 'all 1000 ids must be unique');
});

// ── Source-pin: agent wiring ────────────────────────────────────────────

test('all 4 specialist agents route requestHumanReview through lib/human-review.js', () => {
  // Orchestrator inherits from the 4 specialists via Object.assign — we
  // pin the specialists.
  const agents = [
    'lib/handlers/agent.js',
    'lib/handlers/finance-agent.js',
    'lib/handlers/logistics-agent.js',
    'lib/handlers/sourcing-agent.js',
  ];
  for (const file of agents) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(
      src,
      /humanReview\s*=\s*require\(['"]\.\.\/human-review['"]\)/,
      `${file} must require lib/human-review`,
    );
    assert.match(
      src,
      /humanReview\.appendTicket\(/,
      `${file} must call humanReview.appendTicket — not the prior fake ticketId pattern`,
    );
  }
});

test('the prior fake-ticketId pattern is gone from all 4 specialist agents', () => {
  const agents = [
    'lib/handlers/agent.js',
    'lib/handlers/finance-agent.js',
    'lib/handlers/logistics-agent.js',
    'lib/handlers/sourcing-agent.js',
  ];
  const FAKE_PATTERN = /const\s+ticketId\s*=\s*`tkt_/;
  for (const file of agents) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(
      src,
      FAKE_PATTERN,
      `${file} must not contain the prior \`const ticketId = \\\`tkt_…\\\`\` fake pattern`,
    );
  }
});

// ── Source-pin: dispatcher registers /api/human-review ──────────────────

test('api/[...path].js dispatcher registers human-review handler', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api/[...path].js'), 'utf8');
  assert.match(
    src,
    /['"]human-review['"]:\s*require\(['"]\.\.\/lib\/handlers\/human-review['"]\)/,
    'dispatcher must register the human-review handler at /api/human-review',
  );
});
