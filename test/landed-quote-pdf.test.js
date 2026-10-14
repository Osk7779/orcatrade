'use strict';

// Sprint 15 — customer-shareable landed-cost quote PDF.
//
// Tests cover four layers:
//   1. PDF generation: every required field is honoured; non-WinAnsi
//      input survives normalization (Vietnamese diacritics, em dash,
//      smart quotes); pre-quote requests render without throwing.
//   2. Handler wiring: GET /api/imports/<id>/quote routes through to
//      generateLandedQuotePdf; pre-quote returns 409 (not 500); auth +
//      org-scoping reuse the dossier pattern.
//   3. Email integration: sendQuoteReadyEmail generates + attaches the
//      PDF; PDF generation failure must NOT block the email.
//   4. UI drift-guard: detail page renders BOTH the quote-download
//      AND dossier-download buttons inside the same landedQuote-gated
//      section so they always appear/disappear together.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { generateLandedQuotePdf } = require('../lib/intelligence/landed-quote-pdf');

const ROOT = path.resolve(__dirname, '..');

// Minimal valid request shape — the orchestrator persists every
// landedQuote with these fields populated. Used as a base across the
// pure-function tests.
function buildRequest(over = {}) {
  return {
    externalId: 'ir_test_q1',
    label: 'Test request',
    status: 'quote_ready',
    originCountry: 'CN',
    destinationCountry: 'DE',
    productDescription: 'LED grow lights, 300W full-spectrum.',
    targetQuantity: 500,
    targetQuantityUnit: 'pieces',
    targetUnitPriceCents: 13000,
    certificationRequirements: ['CE', 'RoHS'],
    landedQuote: {
      components: [
        { label: 'Cargo value (EXW)', component: 'goods', eurCents: 6500000, note: 'sourcing-quote' },
        { label: 'Sea freight CN -> DE', component: 'freight', eurCents: 280000, note: null },
        { label: 'MFN duty (3.7%)', component: 'duty', eurCents: 240500, note: null },
        { label: 'VAT (19%)', component: 'vat', eurCents: 1241995, note: null },
        { label: 'OrcaTrade managed-import fee (8%)', component: 'orcatrade_fee', eurCents: 520000, note: null },
      ],
      cargoValueCents: 6500000,
      totalLandedCents: 8782495,
      orcatradeFeeCents: 520000,
      orcatradeFeePct: 8,
      confidenceTier: 'B',
    },
    shortlist: {
      shortlist: [
        { country: 'Shenzhen, CN', label: 'Shenzhen, CN', recommendation: 'top_pick', rationale: 'Largest cluster.' },
        { country: 'Vietnam', label: 'Vietnam', recommendation: 'alternative', rationale: 'Diversification.' },
      ],
      methodology: { sampleSource: 'sourcing-quote.shortlistSuppliers' },
    },
    ...over,
  };
}

// ── PDF generation ──────────────────────────────────────────────────

test('generateLandedQuotePdf returns a non-empty PDF byte stream', async () => {
  const bytes = await generateLandedQuotePdf({
    request: buildRequest(),
    generatedAt: '2026-06-16',
    validUntil: '2026-06-30',
  });
  assert.ok(bytes instanceof Uint8Array, 'returns a Uint8Array');
  assert.ok(bytes.length > 1000, 'PDF byte stream is reasonably sized (>1KB)');
  // Every PDF starts with %PDF (4 bytes). Trivial smoke that we got a
  // real PDF and not a JSON error response.
  const head = String.fromCharCode(...bytes.slice(0, 4));
  assert.equal(head, '%PDF', 'output starts with the %PDF magic bytes');
});

test('generateLandedQuotePdf survives non-WinAnsi input (Vietnamese diacritics, smart quotes, em dash)', async () => {
  // Real customer data carries Unicode that StandardFonts.Helvetica
  // can't encode. The module's toWinAnsi() normalizer must strip /
  // map these so the save() doesn't throw. A regression here would
  // crash the dossier endpoint on the FIRST Vietnamese supplier.
  const request = buildRequest({
    productDescription: 'Premium— "smart" lighting (Hồ Chí Minh sourced)',
    shortlist: {
      shortlist: [
        { country: 'Hồ Chí Minh, VN', label: 'Hồ Chí Minh, VN', recommendation: 'top_pick', rationale: 'Vietnamese cluster.' },
        { country: '深圳, CN', label: '深圳, CN', recommendation: 'alternative', rationale: 'Chinese fallback.' },
      ],
      methodology: { sampleSource: 'sourcing-quote.shortlistSuppliers' },
    },
  });
  const bytes = await generateLandedQuotePdf({ request, generatedAt: '2026-06-16' });
  assert.ok(bytes.length > 1000);
});

test('generateLandedQuotePdf survives a pre-quote request (no landedQuote, no shortlist)', async () => {
  // The handler 409s before we get here, but the generator itself
  // must be defensive — defensive layers are cheap and a refactor
  // that removes the 409 gate must not produce a crashing endpoint.
  const request = buildRequest({ landedQuote: null, shortlist: null });
  const bytes = await generateLandedQuotePdf({ request, generatedAt: '2026-06-16' });
  assert.ok(bytes.length > 500, 'still renders (cover + intent + placeholders)');
});

test('generateLandedQuotePdf produces a structurally valid PDF (opens without trailing-bytes corruption)', async () => {
  // pdf-lib flate-compresses content streams by default so naive
  // ASCII scans for "OrcaTrade" / customer-label won't work. The
  // structural-validity check we CAN do cheaply: the trailing %%EOF
  // marker must be present, indicating pdf-lib completed the document
  // structure rather than aborting mid-save. This catches a class of
  // failure where the helpers throw on the last page but earlier
  // pages render — the file would still start %PDF but no PDF reader
  // could open it.
  const bytes = await generateLandedQuotePdf({
    request: buildRequest({ label: 'My greenhouse LED order' }),
    generatedAt: '2026-06-16',
  });
  const tail = Buffer.from(bytes).slice(-32).toString('latin1');
  assert.ok(tail.includes('%%EOF'), 'PDF must end with the %%EOF marker (structurally complete)');
});

// ── Handler wiring ──────────────────────────────────────────────────

const HANDLER_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'handlers', 'imports.js'),
  'utf8',
);

test('imports handler routes /api/imports/<id>/quote → handleQuotePdf', () => {
  // The action gate + the handler function must both exist. Drift-
  // guard against a refactor that wires the route but forgets to
  // define the handler (silent 500) or vice versa (dead code).
  assert.match(HANDLER_SRC, /if \(action === ['"]quote['"]\)/);
  assert.match(HANDLER_SRC, /handleQuotePdf\(req, res, ctx, externalId\)/);
  assert.match(HANDLER_SRC, /async function handleQuotePdf\(/);
});

test('handleQuotePdf returns 409 (not 500) on a pre-quote request', () => {
  // The endpoint shape promise: callers can `fetch()` it speculatively
  // and use a 409 to mean "quote not ready yet" without parsing the
  // error message. Pin the status code.
  const block = HANDLER_SRC.match(/async function handleQuotePdf\([\s\S]*?\n\}/);
  assert.ok(block, 'handleQuotePdf body not located');
  assert.match(block[0], /!request\.landedQuote/);
  assert.match(block[0], /jsonResponse\(res,\s*409/);
});

test('handleQuotePdf sets Content-Disposition: attachment (forces browser download)', () => {
  const block = HANDLER_SRC.match(/async function handleQuotePdf\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /Content-Disposition.*attachment.*filename=/);
  assert.match(block[0], /Cache-Control.*no-store/);
  assert.match(block[0], /Content-Type.*application\/pdf/);
});

test('handleQuotePdf delegates to lib/intelligence/landed-quote-pdf (not the Studio renderer)', () => {
  // The Studio renderer (lib/intelligence/quote-pdf.js) is for a
  // DIFFERENT flow (internal team supplier-PDF rebranding, sprint
  // quote-rebrand-v1). A future refactor that swaps the import would
  // silently render the wrong document — pin the import path.
  const block = HANDLER_SRC.match(/async function handleQuotePdf\([\s\S]*?\n\}/);
  assert.ok(block);
  assert.match(block[0], /require\(['"]\.\.\/intelligence\/landed-quote-pdf['"]\)/);
});

// ── Email integration ──────────────────────────────────────────────

const EMAILS_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'imports-emails.js'),
  'utf8',
);

test('sendQuoteReadyEmail attaches the landed-quote PDF when landedQuote exists', () => {
  // Pin the attachment-generation block so a refactor that moves it
  // somewhere else (or accidentally drops it) surfaces here.
  const block = EMAILS_SRC.match(/async function sendQuoteReadyEmail\([\s\S]*?\n\}/);
  assert.ok(block, 'sendQuoteReadyEmail body not located');
  const body = block[0];
  assert.match(body, /landed-quote-pdf/);
  assert.match(body, /generateLandedQuotePdf/);
  assert.match(body, /toString\(['"]base64['"]\)/);
});

test('sendQuoteReadyEmail PDF failure does NOT block the email send', () => {
  // Fail-soft: a pdf-lib crash on exotic Unicode (or a missing
  // landedQuote shape during a partial rollout) must not break the
  // quote-ready notification. Customer still gets the prose summary
  // + can download from the dashboard. Pin the try/catch + the
  // warn-log path.
  const block = EMAILS_SRC.match(/async function sendQuoteReadyEmail\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  assert.match(body, /try\s*\{[\s\S]*?generateLandedQuotePdf[\s\S]*?\}\s*catch/);
  assert.match(body, /sending without attachment/);
});

test('sendQuoteReadyEmail still calls email.send AFTER an attachment failure', () => {
  // The catch block must NOT return early — email.send still fires
  // with attachments = null (the initial value).
  const block = EMAILS_SRC.match(/async function sendQuoteReadyEmail\([\s\S]*?\n\}/);
  assert.ok(block);
  const body = block[0];
  // email.send call appears AFTER the try/catch.
  const catchIdx = body.search(/catch\s*\(/);
  const sendIdx = body.search(/email\.send\(\{/);
  assert.ok(catchIdx > -1 && sendIdx > -1, 'both catch and email.send must appear');
  assert.ok(sendIdx > catchIdx, 'email.send must fire AFTER the PDF try/catch (fail-soft)');
});

// ── email.send attachment support ──────────────────────────────────

const EMAIL_SRC = fs.readFileSync(
  path.join(ROOT, 'lib', 'email.js'),
  'utf8',
);

test('email.send accepts an optional attachments[] array', () => {
  // The Resend API attachment shape is { filename, content (base64) }.
  // Pin both fields in the validation logic so a future refactor that
  // renames either (e.g. to follow some other vendor's "name"/"data"
  // shape) breaks here at PR time.
  assert.match(EMAIL_SRC, /attachments\s*=\s*null/);
  assert.match(EMAIL_SRC, /\.filename\b/);
  assert.match(EMAIL_SRC, /\.content\b/);
});

test('email.send drops malformed attachments rather than failing the send', () => {
  // A malformed attachment entry (missing filename or content) would
  // make Resend reject the whole email. Filter to valid entries; if
  // none survive, omit the attachments key entirely.
  assert.match(EMAIL_SRC, /attachments\.filter/);
});

// ── UI drift-guard: detail page shareable-artifacts section ─────────

const DETAIL_TSX = fs.readFileSync(
  path.join(ROOT, 'app-shell', 'app', '(authed)', 'imports', '[externalId]', 'page.tsx'),
  'utf8',
);

test('detail page renders BOTH quote + dossier download buttons under the same landedQuote gate', () => {
  // The two artifacts must appear or disappear together. A future
  // refactor that splits them across two gates risks "quote present
  // but no dossier" or vice versa, confusing the customer.
  assert.match(DETAIL_TSX, /Download quote \(PDF\)/);
  assert.match(DETAIL_TSX, /Download dossier \(PDF\)/);

  // Pin them inside the same conditional block. Walk forward from
  // "Share with your CFO" (the quote panel's eyebrow) to the closing
  // </section>; the dossier copy must appear inside that span. The
  // detail page has multiple `landedQuote && (...)` gates (WhatIfPanel
  // is also gated this way) so we can't naively grab the first match.
  const shareIdx = DETAIL_TSX.indexOf('Share with your CFO');
  assert.ok(shareIdx > 0, '"Share with your CFO" eyebrow not found');
  const closeIdx = DETAIL_TSX.indexOf('</section>', shareIdx);
  assert.ok(closeIdx > shareIdx, 'closing </section> not found after the share-with-CFO eyebrow');
  const span = DETAIL_TSX.slice(shareIdx, closeIdx);
  assert.match(span, /Download quote \(PDF\)/);
  assert.match(span, /Download dossier \(PDF\)/);
});

test('detail page download buttons target the right endpoints', () => {
  assert.match(DETAIL_TSX, /\/api\/imports\/\$\{request\.externalId\}\/quote/);
  assert.match(DETAIL_TSX, /\/api\/imports\/\$\{request\.externalId\}\/dossier/);
});

test('detail page uses <a download> for browser-level "save as" support', () => {
  // The <a download> attribute hints filename to the browser. Without
  // it, the browser falls back to the URL's last segment ("quote"),
  // which is meaningless to the customer. Pin both buttons carry it.
  assert.match(DETAIL_TSX, /download=\{`orcatrade-quote-/);
  assert.match(DETAIL_TSX, /download=\{`orcatrade-compliance-/);
});
