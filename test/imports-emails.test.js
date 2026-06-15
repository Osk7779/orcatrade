'use strict';

// Import-Request email touchpoints — composition + dispatcher tests.
// Send-path failures and KV writes use lightweight stubs because the
// Resend + KV upstreams are not deterministic to exercise in unit
// tests; integration testing happens via the post-deploy smoke suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const importsEmails = require(path.join(ROOT, 'lib', 'imports-emails'));

const REQUEST_FIXTURE = Object.freeze({
  externalId: 'ir_abc123',
  label: 'Q3 silicone mats',
  productDescription: '3,000 silicone kitchen mats food-grade',
  originCountry: 'CN',
  destinationCountry: 'DE',
  landedQuote: {
    cargoValueCents: 2_500_000,
    totalLandedCents: 3_200_000,
    orcatradeFeeCents: 200_000,
    orcatradeFeePct: 8,
    confidenceTier: 'B',
    confidenceNotes: [
      'HS classification confidence is LOW — team review must verify before this quote ships to the customer.',
    ],
  },
});

// ── URL helpers (build under SITE_ORIGIN, default to .pl) ────────────

test('customerRequestUrl points to the customer-facing detail page under /app', () => {
  const url = importsEmails.customerRequestUrl('ir_x');
  assert.match(url, /\/app\/imports\/ir_x$/);
});

test('opsQueueUrl points to /app/imports/queue', () => {
  assert.match(importsEmails.opsQueueUrl(), /\/app\/imports\/queue$/);
});

test('opsRequestUrl mirrors customerRequestUrl (same single-page surface for team + customer in v1)', () => {
  assert.equal(importsEmails.opsRequestUrl('ir_x'), importsEmails.customerRequestUrl('ir_x'));
});

test('URL helpers honour SITE_ORIGIN env override', () => {
  const prior = process.env.SITE_ORIGIN;
  process.env.SITE_ORIGIN = 'https://orcatradegroup.com';
  try {
    assert.equal(importsEmails.customerRequestUrl('ir_x'), 'https://orcatradegroup.com/app/imports/ir_x');
    assert.equal(importsEmails.opsQueueUrl(), 'https://orcatradegroup.com/app/imports/queue');
  } finally {
    if (prior !== undefined) process.env.SITE_ORIGIN = prior;
    else delete process.env.SITE_ORIGIN;
  }
});

// ── ORCATRADE_OPS_INBOX parsing ─────────────────────────────────────

test('getOpsInbox returns [] when ORCATRADE_OPS_INBOX is unset', () => {
  const prior = process.env.ORCATRADE_OPS_INBOX;
  delete process.env.ORCATRADE_OPS_INBOX;
  try {
    assert.deepEqual(importsEmails.getOpsInbox(), []);
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_OPS_INBOX = prior;
  }
});

test('getOpsInbox parses a comma-separated list, trims, and drops non-emails', () => {
  const prior = process.env.ORCATRADE_OPS_INBOX;
  process.env.ORCATRADE_OPS_INBOX = ' ops@orcatrade.pl, leads@orcatrade.pl ,not-an-email,, founder@orcatrade.pl';
  try {
    assert.deepEqual(importsEmails.getOpsInbox(), [
      'ops@orcatrade.pl', 'leads@orcatrade.pl', 'founder@orcatrade.pl',
    ]);
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_OPS_INBOX = prior;
    else delete process.env.ORCATRADE_OPS_INBOX;
  }
});

// ── composeQuoteReady ────────────────────────────────────────────────

test('composeQuoteReady subject + text carry label, total, confidence tier, and a deep link', () => {
  const { subject, text } = importsEmails.composeQuoteReady(REQUEST_FIXTURE);
  assert.match(subject, /Your import quote is ready/);
  assert.match(subject, /Q3 silicone mats/);
  assert.match(text, /Request: Q3 silicone mats\s+\(ir_abc123\)/);
  assert.match(text, /Landed total: €32,000/);
  assert.match(text, /confidence tier B/);
  assert.match(text, /\/app\/imports\/ir_abc123/);
});

test('composeQuoteReady tolerates a missing landedQuote (fallback to —)', () => {
  const { text } = importsEmails.composeQuoteReady({
    externalId: 'ir_x', label: 'L', productDescription: 'P',
  });
  assert.match(text, /Landed total: —/);
});

// ── composeNewInQueue ────────────────────────────────────────────────

test('composeNewInQueue subject is OPS-prefixed and includes total', () => {
  const { subject } = importsEmails.composeNewInQueue(REQUEST_FIXTURE);
  assert.match(subject, /^\[OPS\] New import request awaiting review/);
  assert.match(subject, /Q3 silicone mats/);
  assert.match(subject, /€32,000/);
});

test('composeNewInQueue text surfaces the route, warnings, and BOTH detail + queue links', () => {
  const { text } = importsEmails.composeNewInQueue(REQUEST_FIXTURE);
  assert.match(text, /Route:\s+CN → DE/);
  assert.match(text, /Warnings \(1\):/);
  assert.match(text, /HS classification confidence is LOW/);
  assert.match(text, /\/app\/imports\/ir_abc123/);
  assert.match(text, /\/app\/imports\/queue/);
});

test('composeNewInQueue text says "No calculator warnings" when confidenceNotes is empty', () => {
  const noWarn = {
    ...REQUEST_FIXTURE,
    landedQuote: { ...REQUEST_FIXTURE.landedQuote, confidenceNotes: [] },
  };
  const { text } = importsEmails.composeNewInQueue(noWarn);
  assert.match(text, /No calculator warnings\./);
});

// ── composeCustomerApproved ──────────────────────────────────────────

test('composeCustomerApproved with a shipment surfaces the shipment id + status', () => {
  const { subject, text } = importsEmails.composeCustomerApproved(REQUEST_FIXTURE, {
    externalId: 'sh_deadbeef00112233', label: 'Q3 silicone mats (from ir_abc123)',
  });
  assert.match(subject, /\[OPS\] Customer approved/);
  assert.match(subject, /fulfilment begins/);
  assert.match(text, /Shipment row materialised:/);
  assert.match(text, /sh_deadbeef00112233/);
  assert.match(text, /status: planned/);
});

test('composeCustomerApproved without a shipment flags the manual-create branch', () => {
  const { text } = importsEmails.composeCustomerApproved(REQUEST_FIXTURE, null);
  assert.match(text, /⚠ Shipment row did NOT materialise automatically — manual create/);
});

// ── Send dispatchers — env-gated short-circuit paths ────────────────

test('sendQuoteReadyEmail short-circuits when no customer contact is on file', async () => {
  // KV may or may not be configured in the test env; either way, an
  // externalId with no stored contact has no recipient.
  const result = await importsEmails.sendQuoteReadyEmail({
    request: { externalId: 'ir_never_stored_' + Math.floor(Math.random() * 1e9) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-contact');
});

test('sendNewInQueueEmail short-circuits when ORCATRADE_OPS_INBOX is unset', async () => {
  const prior = process.env.ORCATRADE_OPS_INBOX;
  delete process.env.ORCATRADE_OPS_INBOX;
  try {
    const result = await importsEmails.sendNewInQueueEmail({ request: REQUEST_FIXTURE });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-inbox');
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_OPS_INBOX = prior;
  }
});

test('sendCustomerApprovedEmail short-circuits when ORCATRADE_OPS_INBOX is unset', async () => {
  const prior = process.env.ORCATRADE_OPS_INBOX;
  delete process.env.ORCATRADE_OPS_INBOX;
  try {
    const result = await importsEmails.sendCustomerApprovedEmail({
      request: REQUEST_FIXTURE,
      shipment: null,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-inbox');
  } finally {
    if (prior !== undefined) process.env.ORCATRADE_OPS_INBOX = prior;
  }
});

test('CONTACT_TTL_SECONDS is generous enough for slow-burn requests (≥ 30 days)', () => {
  // 30 days = 2,592,000 seconds. Anything shorter risks the customer's
  // email evaporating before the team reviews + the customer decides.
  assert.ok(importsEmails.CONTACT_TTL_SECONDS >= 30 * 86_400);
});

test('all three send entry points return { ok: false } shape on guard-rail rejection', async () => {
  for (const fn of [
    importsEmails.sendQuoteReadyEmail,
    importsEmails.sendNewInQueueEmail,
    importsEmails.sendCustomerApprovedEmail,
  ]) {
    const r = await fn({});
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
  }
});
