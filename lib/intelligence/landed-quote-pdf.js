// @ts-check
'use strict';

// Customer-shareable landed-cost quote PDF — sprint 15.
//
// Distinct from lib/intelligence/quote-pdf.js (the internal Quote Studio
// renderer that brands a supplier PDF, sprint quote-rebrand-v1). This
// module renders the LANDED-COST quote attached to an import_request:
// the customer's CFO / procurement approver downloads it from the
// detail page, or receives it as an attachment on the quote-ready
// email. Tight one-pager with:
//   1. Cover metadata (request id, route, validity)
//   2. Customer intent recap
//   3. Landed cost breakdown — the centrepiece
//   4. Supplier shortlist preview (top 3 countries, no factory names)
//   5. How to accept + how-we-stand-behind-the-numbers callout
//
// Calculator-grounding (ADR 0002): every number reads from the
// import_request.landedQuote that the orchestrator persisted. The LLM
// never sees this code; no number on the PDF originates from a model.
//
// PDF tooling: pdf-lib (same as compliance-dossier.js). WinAnsi-safe
// content only — use "->" / "-" not Unicode arrows / em-dashes (the
// partner brief script learned this the hard way: StandardFonts
// cannot encode those characters and the save() throws).
//
// Why a separate module (not a shared primitives extraction from
// compliance-dossier.js): two generators is below the threshold where
// a shared helper starts to pay off. If a third lands (e.g. revision-
// quote-pdf), this is the moment to extract drawText/drawHeading/etc.
// into lib/intelligence/pdf-primitives.js. Today the abstraction would
// just add an indirection for negligible reuse.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// WinAnsi encoder coverage check — StandardFonts.Helvetica can only encode
// the Latin-1 subset that fits the WinAnsi code page. Real customer data
// brings:
//   - Vietnamese diacritics in supplier city labels (Hồ Chí Minh)
//   - CJK characters in factory names (深圳)
//   - Currency / typographic punctuation (em dash, smart quotes) from
//     pasted product descriptions
// Any one of these throws inside page.drawText() and the PDF fails to
// generate. Normalising every drawText input with toWinAnsi() is the
// pragmatic fix until a CJK-capable font ships (NotoSans subsetting is
// ~6MB and pdf-lib has no built-in subsetter — that's a sprint of its
// own).
//
// Strategy:
//   1. NFD-decompose so Latin diacritics split into base + combining mark
//   2. Strip combining marks (covers Vietnamese, Polish, German, French
//      diacritics in one pass)
//   3. Map common typographic punctuation to ASCII equivalents
//   4. Replace any remaining non-WinAnsi codepoint with '?'
//
// The visible effect on Vietnamese is "Hồ Chí Minh" -> "Ho Chi Minh"
// which still resolves to the right city. CJK degrades to "?" but the
// caller (the orchestrator) typically produces country-level labels in
// Latin script so this rarely fires for the shortlist preview.
//
// Last-resort '?' is deliberate: we'd rather render a glyph-stub than
// throw and produce no PDF at all. The customer can still read the
// numbers.
const WINANSI_PUNCT_MAP = new Map([
  ['–', '-'],  // en dash
  ['—', '-'],  // em dash
  ['‘', "'"],  // left single quote
  ['’', "'"],  // right single quote
  ['“', '"'],  // left double quote
  ['”', '"'],  // right double quote
  ['…', '...'],// ellipsis
  [' ', ' '],  // nbsp
  ['→', '->'], // rightwards arrow
  ['↔', '<->'],// left right arrow
]);

/** @param {string} s */
function toWinAnsi(s) {
  if (s == null) return '';
  let out = String(s).normalize('NFD').replace(/\p{M}+/gu, '');
  out = out.split('').map((c) => WINANSI_PUNCT_MAP.get(c) || c).join('');
  // After decomposition + mark-stripping, anything outside WinAnsi
  // (codepoint > 0xFF excluding the bullet 0x2022 which IS in WinAnsi)
  // falls back to '?'. 0x2022 is intentionally preserved because the
  // PDF body uses "·" (0x00B7 middle dot, in WinAnsi) but downstream
  // text may carry the bullet equivalent.
  return out.split('').map((c) => {
    const cp = c.codePointAt(0) || 0;
    if (cp <= 0xff) return c;
    if (cp === 0x2022) return c;
    return '?';
  }).join('');
}

const AQUA = rgb(0.133, 0.827, 0.933);
const INK = rgb(0.04, 0.04, 0.04);
const MUTED = rgb(0.35, 0.35, 0.4);
const SOFT = rgb(0.55, 0.55, 0.6);
const HAIRLINE = rgb(0.86, 0.88, 0.92);
const SOFT_BG = rgb(0.97, 0.98, 0.99);
const POSITIVE = rgb(0.04, 0.6, 0.4);

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_L = 60;
const MARGIN_R = 60;
const MARGIN_T = 64;
const MARGIN_B = 64;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

/**
 * @param {{ request: any, generatedAt?: string, validUntil?: string }} args
 * @returns {Promise<Uint8Array>}
 */
async function generateLandedQuotePdf({ request, generatedAt, validUntil }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_T;

  /** @param {string} text @param {any} f @param {number} size @param {number} maxW */
  function wrap(text, f, size, maxW) {
    const words = toWinAnsi(text).split(/\s+/);
    /** @type {string[]} */
    const out = [];
    let line = '';
    for (const w of words) {
      const trial = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(trial, size) > maxW && line) {
        out.push(line);
        line = w;
      } else {
        line = trial;
      }
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  }

  /** @param {number} needed */
  function ensureSpace(needed) {
    if (y - needed < MARGIN_B) {
      drawFooter();
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN_T;
      drawHeader();
    }
  }

  /** @param {number} h */
  function gap(h) { y -= h; }

  /**
   * @param {string} text
   * @param {{ f?: any, size?: number, color?: any, leading?: number, maxW?: number, x?: number }} [opts]
   */
  function drawText(text, opts = {}) {
    const f = opts.f || font;
    const size = opts.size != null ? opts.size : 11;
    const color = opts.color || INK;
    const leading = opts.leading || 1.5;
    const maxW = opts.maxW || CONTENT_W;
    const x = opts.x != null ? opts.x : MARGIN_L;
    const lines = wrap(text, f, size, maxW);
    const lineH = size * leading;
    ensureSpace(lines.length * lineH);
    for (const line of lines) {
      page.drawText(line, { x, y, size, font: f, color });
      y -= lineH;
    }
  }

  /**
   * @param {string} text
   * @param {{ size?: number, color?: any, gapBefore?: number, gapAfter?: number }} [opts]
   */
  function drawHeading(text, opts = {}) {
    const size = opts.size != null ? opts.size : 14;
    const color = opts.color || INK;
    const gapBefore = opts.gapBefore != null ? opts.gapBefore : 18;
    const gapAfter = opts.gapAfter != null ? opts.gapAfter : 10;
    gap(gapBefore);
    const lineH = size * 1.35;
    ensureSpace(lineH + gapAfter);
    page.drawText(toWinAnsi(text), { x: MARGIN_L, y, size, font: fontBold, color });
    y -= lineH + gapAfter;
  }

  function drawHairline() {
    const weight = 0.6;
    page.drawRectangle({ x: MARGIN_L, y, width: CONTENT_W, height: weight, color: HAIRLINE });
    y -= weight;
  }

  /**
   * Two-column landed-cost row: component label (left), EUR value
   * right-aligned. Used for the centrepiece breakdown table.
   * @param {string} label
   * @param {string} value
   * @param {{ valueColor?: any, valueFont?: any, labelFont?: any, labelColor?: any, size?: number }} [opts]
   */
  function drawCostRow(label, value, opts = {}) {
    const size = opts.size != null ? opts.size : 11;
    const lineH = size * 1.55;
    const valueFont = opts.valueFont || font;
    const valueColor = opts.valueColor || INK;
    const labelFont = opts.labelFont || font;
    const labelColor = opts.labelColor || INK;
    const safeLabel = toWinAnsi(label || '-');
    const safeValue = toWinAnsi(value || '-');
    ensureSpace(lineH);
    page.drawText(safeLabel, { x: MARGIN_L, y, size, font: labelFont, color: labelColor });
    const valueW = valueFont.widthOfTextAtSize(safeValue, size);
    page.drawText(safeValue, { x: MARGIN_L + CONTENT_W - valueW, y, size, font: valueFont, color: valueColor });
    y -= lineH;
  }

  /**
   * Compact key/value row for the cover metadata.
   * @param {string} label
   * @param {string} value
   */
  function drawMetaRow(label, value) {
    const lineH = 11 * 1.5;
    ensureSpace(lineH);
    page.drawText(toWinAnsi(label), { x: MARGIN_L, y, size: 10, font: fontBold, color: MUTED });
    page.drawText(toWinAnsi(value || '-'), { x: MARGIN_L + 140, y, size: 11, font, color: INK });
    y -= lineH;
  }

  function drawHeader() {
    page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: AQUA });
    page.drawText('OrcaTrade', {
      x: MARGIN_L, y: PAGE_H - MARGIN_T + 4, size: 18, font: fontBold, color: INK,
    });
    page.drawText('Operations', {
      x: MARGIN_L + fontBold.widthOfTextAtSize('OrcaTrade', 18) + 8,
      y: PAGE_H - MARGIN_T + 4, size: 13, font, color: AQUA,
    });
    page.drawRectangle({
      x: MARGIN_L, y: PAGE_H - MARGIN_T - 8,
      width: CONTENT_W, height: 0.6, color: HAIRLINE,
    });
    y = PAGE_H - MARGIN_T - 22;
  }

  function drawFooter() {
    const footerY = MARGIN_B - 30;
    page.drawRectangle({
      x: MARGIN_L, y: footerY + 18,
      width: CONTENT_W, height: 0.6, color: HAIRLINE,
    });
    page.drawText('OrcaTrade Group Ltd  ·  London · Warsaw · Hong Kong', {
      x: MARGIN_L, y: footerY + 6, size: 9, font, color: SOFT,
    });
    page.drawText(toWinAnsi('Landed-cost quote  ·  ' + (request.externalId || '')), {
      x: MARGIN_L, y: footerY - 7, size: 9, font: fontItalic, color: SOFT,
    });
  }

  // ── Cover ──────────────────────────────────────────────────────

  drawHeader();
  drawText('IMPORT QUOTE', { f: fontBold, size: 9, color: SOFT });
  gap(8);
  drawText('Landed-cost summary', { size: 22, leading: 1.2 });
  gap(4);
  drawText(request.label || 'Import request', { f: fontItalic, size: 13, color: MUTED, leading: 1.4 });
  gap(10);
  drawHairline();
  gap(10);

  drawMetaRow('Quote ID', String(request.externalId || '-'));
  drawMetaRow('Issued', generatedAt || new Date().toISOString().slice(0, 10));
  if (validUntil) drawMetaRow('Valid until', String(validUntil));
  drawMetaRow('Route', `${request.originCountry || '?'} -> ${request.destinationCountry || '?'}`);
  drawMetaRow('Status', String(request.status || '-').replace(/_/g, ' '));

  // ── Customer intent recap ─────────────────────────────────────

  drawHeading('Your request', { color: AQUA });
  drawText(String(request.productDescription || '-'), { size: 11, leading: 1.55 });
  gap(8);
  if (request.targetQuantity) {
    drawMetaRow('Quantity', `${Number(request.targetQuantity).toLocaleString('en-IE')} ${request.targetQuantityUnit || 'units'}`);
  }
  if (Number.isFinite(Number(request.targetUnitPriceCents))) {
    drawMetaRow('Target unit price', `EUR ${(Number(request.targetUnitPriceCents) / 100).toFixed(2)}`);
  }
  if (Array.isArray(request.certificationRequirements) && request.certificationRequirements.length) {
    drawMetaRow('Certifications', request.certificationRequirements.join(' · '));
  }

  // ── Landed-cost breakdown — the centrepiece ─────────────────

  drawHeading('Landed cost breakdown', { color: AQUA });
  const quote = request.landedQuote;
  if (quote && Array.isArray(quote.components) && quote.components.length) {
    for (const c of quote.components) {
      const label = String(c.label || c.component || '-');
      const value = 'EUR ' + (Number(c.eurCents) / 100).toFixed(2);
      drawCostRow(label, value);
      if (c.note) {
        drawText(String(c.note), { f: fontItalic, size: 9.5, color: MUTED, leading: 1.3 });
      }
    }
    gap(6);
    drawHairline();
    gap(8);
    drawCostRow(
      'Total landed cost',
      'EUR ' + (Number(quote.totalLandedCents) / 100).toFixed(2),
      { labelFont: fontBold, valueFont: fontBold, size: 13 },
    );
    if (Number.isFinite(Number(quote.orcatradeFeeCents))) {
      drawText(
        `Of which OrcaTrade managed-import fee (${quote.orcatradeFeePct != null ? quote.orcatradeFeePct + '%' : 'flat'}): EUR ` +
        (Number(quote.orcatradeFeeCents) / 100).toFixed(2),
        { f: fontItalic, size: 10, color: MUTED, leading: 1.45 },
      );
    }
    if (quote.confidenceTier) {
      gap(6);
      drawMetaRow('Quote confidence', String(quote.confidenceTier).toUpperCase());
    }
  } else {
    drawText('No landed-cost quote on this request yet.', { size: 10.5, color: MUTED, leading: 1.5 });
  }

  // ── Supplier shortlist preview ───────────────────────────────

  const shortlist = request.shortlist;
  drawHeading('Recommended supplier countries', { color: AQUA });
  if (shortlist && Array.isArray(shortlist.shortlist) && shortlist.shortlist.length) {
    for (const s of shortlist.shortlist.slice(0, 3)) {
      const tag = s.recommendation === 'top_pick' ? '[TOP PICK]' : '[ALTERNATIVE]';
      const tagColor = s.recommendation === 'top_pick' ? POSITIVE : MUTED;
      const country = String(s.country || s.code || '-');
      const label = String(s.label || country);
      ensureSpace(11 * 1.6);
      page.drawText(tag, { x: MARGIN_L, y, size: 9, font: fontBold, color: tagColor });
      page.drawText(toWinAnsi(label), { x: MARGIN_L + 95, y, size: 11, font: fontBold, color: INK });
      y -= 11 * 1.5;
      if (s.rationale) {
        drawText(String(s.rationale), { size: 10.5, color: MUTED, leading: 1.45 });
        gap(2);
      }
    }
    if (shortlist.methodology && shortlist.methodology.sampleSource) {
      gap(4);
      drawText(
        `Suppliers shown are anonymised samples drawn from ${shortlist.methodology.sampleSource}. ` +
        'Specific factories are introduced after you accept the quote.',
        { f: fontItalic, size: 9.5, color: MUTED, leading: 1.45 },
      );
    }
  } else {
    drawText('No supplier shortlist has been generated for this request yet.', { size: 10.5, color: MUTED, leading: 1.5 });
  }

  // ── Acceptance + footnote ────────────────────────────────────

  drawHeading('How to accept this quote', { color: AQUA });
  drawText(
    `Sign in to your OrcaTrade dashboard, open request ${request.externalId || ''} and click "Approve". ` +
    'On approval, we materialise the goods + supplier + shipment records, you receive a confirmation email ' +
    'with the booking reference, and the operations team takes the request to fulfilment.',
    { size: 10.5, leading: 1.55 },
  );

  // ── Disclaimer callout ───────────────────────────────────────

  gap(14);
  const disclaimer =
    'This quote is calculator-grounded and reflects published EU duty rates, current carrier indices, ' +
    'and a deterministic landed-cost model. Final classification + customs filing follow your broker\'s ' +
    'verification against the 8-10 digit TARIC code. Quote valid through ' +
    (validUntil || 'the date shown above') + '; revisions ship as a new quote.';
  const padX = 14;
  const padY = 12;
  const bodyLines = wrap(disclaimer, font, 10, CONTENT_W - padX * 2);
  const blockH = padY * 2 + 10 * 1.4 + bodyLines.length * 10 * 1.45;
  ensureSpace(blockH + 6);
  page.drawRectangle({
    x: MARGIN_L, y: y - blockH, width: CONTENT_W, height: blockH, color: SOFT_BG,
  });
  page.drawRectangle({
    x: MARGIN_L, y: y - blockH, width: 3, height: blockH, color: AQUA,
  });
  let cursorY = y - padY - 10;
  page.drawText('How we stand behind these numbers', {
    x: MARGIN_L + padX, y: cursorY, size: 10, font: fontBold, color: INK,
  });
  cursorY -= 10 * 0.4 + 6;
  for (const line of bodyLines) {
    cursorY -= 10;
    page.drawText(line, { x: MARGIN_L + padX, y: cursorY, size: 10, font, color: INK });
    cursorY -= 10 * 0.45;
  }
  y -= blockH + 6;

  drawFooter();
  return await doc.save();
}

module.exports = {
  generateLandedQuotePdf,
};
