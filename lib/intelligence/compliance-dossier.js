// @ts-check
'use strict';

// Compliance dossier PDF generator — sprint 12 ch 2.
//
// Produces a calculator-grounded, brand-styled PDF that the customer
// can hand to their customs broker / freight forwarder. The dossier
// is a snapshot of the import_request's compliance posture at the
// moment of generation: customer intent, HS classification with
// confidence, CBAM / EUDR / REACH applicability with regulation
// citations, and the structured landed-cost quote.
//
// Calculator-grounding (ADR 0002): every claim in the dossier
// traces back to a calculator output that is already persisted on
// the import_request row. No LLM enters this flow. The disclaimer
// page makes the "verify against the 8-10 digit TARIC code"
// expectation explicit so the broker doesn't treat the dossier as
// a final ruling.
//
// PDF tooling: pdf-lib (already a repo-root dependency, also used by
// scripts/generate-partner-brief.js). WinAnsi-safe content only —
// avoid → ↔ ↑ and similar Unicode symbols that the standard fonts
// cannot encode (the partner brief learned this the hard way).

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// Brand palette — matches the app-shell aqua + ivory + navy that
// the imports surface uses. PDF colours are RGB 0-1.
const AQUA = rgb(0.133, 0.827, 0.933);    // #22d3ee
const INK = rgb(0.04, 0.04, 0.04);
const MUTED = rgb(0.35, 0.35, 0.4);
const SOFT = rgb(0.55, 0.55, 0.6);
const HAIRLINE = rgb(0.86, 0.88, 0.92);
const SOFT_BG = rgb(0.97, 0.98, 0.99);

const PAGE_W = 595;   // A4 width in points
const PAGE_H = 842;
const MARGIN_L = 60;
const MARGIN_R = 60;
const MARGIN_T = 64;
const MARGIN_B = 64;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

/**
 * @param {{ request: any, generatedAt?: string }} args
 * @returns {Promise<Uint8Array>}
 */
async function generateComplianceDossier({ request, generatedAt }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_T;

  // Helpers — pure-function PDF primitives mirroring the partner-
  // brief script's convention (y is the BASELINE of the next line).

  /** @param {string} text @param {any} f @param {number} size @param {number} maxW */
  function wrap(text, f, size, maxW) {
    const words = String(text == null ? '' : text).split(/\s+/);
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
    page.drawText(text, { x: MARGIN_L, y, size, font: fontBold, color });
    y -= lineH + gapAfter;
  }

  /**
   * @param {string} label
   * @param {string} value
   * @param {{ valueColor?: any, valueFont?: any }} [opts]
   */
  function drawKv(label, value, opts = {}) {
    const lineH = 11 * 1.5;
    const labelColW = 180;     // sprint 12 ch 2 fix: was 140; longer labels (e.g.
    const valueColX = MARGIN_L + 190; // "OrcaTrade managed-import service (8%)") overflowed.
    const valueMaxW = CONTENT_W - 190;
    const valueColor = opts.valueColor || INK;
    const valueFont = opts.valueFont || font;
    const labelLines = wrap(label, fontBold, 10, labelColW);
    const valueLines = wrap(value || '-', valueFont, 11, valueMaxW);
    const totalLines = Math.max(labelLines.length, valueLines.length);
    ensureSpace(totalLines * lineH);
    const startY = y;
    // Render label column (size 10, bold, muted)
    for (let i = 0; i < labelLines.length; i++) {
      page.drawText(labelLines[i] || '', {
        x: MARGIN_L,
        y: startY - i * lineH,
        size: 10, font: fontBold, color: MUTED,
      });
    }
    // Render value column (size 11)
    for (let i = 0; i < valueLines.length; i++) {
      page.drawText(valueLines[i] || '', {
        x: valueColX,
        y: startY - i * lineH,
        size: 11, font: valueFont, color: valueColor,
      });
    }
    y -= totalLines * lineH;
  }

  function drawHairline() {
    const weight = 0.6;
    page.drawRectangle({ x: MARGIN_L, y, width: CONTENT_W, height: weight, color: HAIRLINE });
    y -= weight;
  }

  /**
   * @param {string} bg
   * @param {string} title
   * @param {string} body
   * @param {{ paddingX?: number, paddingY?: number, accent?: any }} [opts]
   */
  function drawCalloutBox(bg, title, body, opts = {}) {
    void bg;
    const accent = opts.accent || AQUA;
    const padX = opts.paddingX || 14;
    const padY = opts.paddingY || 12;
    const titleSize = 10;
    const bodyLeading = 1.45;
    const bodyLines = wrap(body, font, 10.5, CONTENT_W - padX * 2);
    const blockH = padY * 2 + titleSize * 1.4 + bodyLines.length * 10.5 * bodyLeading;
    ensureSpace(blockH + 6);
    // Background rectangle.
    page.drawRectangle({
      x: MARGIN_L,
      y: y - blockH,
      width: CONTENT_W,
      height: blockH,
      color: SOFT_BG,
    });
    // Aqua left rail.
    page.drawRectangle({
      x: MARGIN_L,
      y: y - blockH,
      width: 3,
      height: blockH,
      color: accent,
    });
    let cursorY = y - padY - titleSize;
    page.drawText(title, {
      x: MARGIN_L + padX, y: cursorY, size: titleSize, font: fontBold, color: INK,
    });
    cursorY -= titleSize * 0.4 + 6;
    for (const line of bodyLines) {
      cursorY -= 10.5;
      page.drawText(line, {
        x: MARGIN_L + padX, y: cursorY, size: 10.5, font, color: INK,
      });
      cursorY -= 10.5 * (bodyLeading - 1);
    }
    y -= blockH + 6;
  }

  function drawHeader() {
    // Aqua top stripe.
    page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: AQUA });
    // Brand mark.
    page.drawText('OrcaTrade', {
      x: MARGIN_L, y: PAGE_H - MARGIN_T + 4, size: 18, font: fontBold, color: INK,
    });
    page.drawText('Operations', {
      x: MARGIN_L + fontBold.widthOfTextAtSize('OrcaTrade', 18) + 8,
      y: PAGE_H - MARGIN_T + 4, size: 13, font, color: AQUA,
    });
    // Page header rule.
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
    page.drawText('Compliance Dossier  ·  ' + (request.externalId || ''), {
      x: MARGIN_L, y: footerY - 7, size: 9, font: fontItalic, color: SOFT,
    });
  }

  // ── Page 1 — cover + intent + HS classification ────────────────

  drawHeader();
  drawText('PARTNER COMPLIANCE DOSSIER', { f: fontBold, size: 9, color: SOFT });
  gap(8);
  drawText('Calculator-grounded compliance posture', { size: 22, leading: 1.2 });
  gap(4);
  drawText(request.label || 'Import request', { f: fontItalic, size: 13, color: MUTED, leading: 1.4 });
  gap(8);
  drawHairline();
  gap(10);

  // Cover metadata
  drawKv('Request ID', request.externalId || '-');
  drawKv('Generated', generatedAt || new Date().toISOString().slice(0, 10));
  drawKv('Status', String(request.status || '-').replace(/_/g, ' '));
  drawKv('Route', `${request.originCountry || '?'} -> ${request.destinationCountry || '?'}`);
  if (request.targetDeliveryDate) drawKv('Target delivery', String(request.targetDeliveryDate));

  // ── Customer intent ───────────────────────────────────────────

  drawHeading('Customer intent', { color: AQUA });
  drawText(String(request.productDescription || '-'), { size: 11, leading: 1.55 });
  gap(8);
  const intentRows = [];
  if (request.targetQuantity) {
    intentRows.push(['Quantity', `${Number(request.targetQuantity).toLocaleString('en-IE')} ${request.targetQuantityUnit || 'units'}`]);
  }
  if (Number.isFinite(Number(request.targetUnitPriceCents))) {
    intentRows.push(['Target landed unit price', `EUR ${(Number(request.targetUnitPriceCents) / 100).toFixed(2)}`]);
  }
  if (Array.isArray(request.certificationRequirements) && request.certificationRequirements.length) {
    intentRows.push(['Certifications', request.certificationRequirements.join(' · ')]);
  }
  for (const [k, v] of intentRows) drawKv(k, v);

  // ── HS classification ─────────────────────────────────────────

  const hsClass = request.landedQuote
    && request.landedQuote.methodology
    && request.landedQuote.methodology.hsClassification;
  drawHeading('HS classification', { color: AQUA });
  if (hsClass) {
    drawKv('Suggested HS', hsClass.hs6 || (request.hsCodeGuess || '999999'));
    if (hsClass.label) drawKv('Label', String(hsClass.label));
    if (hsClass.chapter != null) drawKv('Chapter', String(hsClass.chapter));
    if (hsClass.confidenceTier) drawKv('Confidence', String(hsClass.confidenceTier).toUpperCase());
    if (hsClass.verifyUrl) drawKv('Verify', String(hsClass.verifyUrl));
    drawKv('Source', hsClass.source || 'lib/intelligence/hs-code-lookup.js (ADR 0016)');
  } else {
    drawKv('Suggested HS', request.hsCodeGuess || '999999');
    drawKv('Source', 'Customer-provided guess');
  }

  // ── Page 2+ — regulatory applicability ────────────────────────

  drawHeading('EU compliance applicability', { color: AQUA });
  drawText(
    'Each EU regulatory regime below has been probed against the customer intent and HS classification above. ' +
    'The verdict is calculator-grounded and cites the binding regulation. ' +
    'Final classification for customs filing requires confirmation against the 8-10 digit TARIC code by your broker.',
    { size: 10.5, leading: 1.55, color: MUTED },
  );

  const probes = request.landedQuote
    && request.landedQuote.complianceProbes;
  /** @type {Array<[string, string, any]>} */
  const probeRows = [
    ['CBAM', 'Carbon Border Adjustment Mechanism', probes && probes.cbam],
    ['EUDR', 'EU Deforestation Regulation', probes && probes.eudr],
    ['REACH', 'Registration, Evaluation, Authorisation and Restriction of Chemicals', probes && probes.reach],
  ];

  for (const [code, fullname, probe] of probeRows) {
    drawHeading(`${code} · ${fullname}`, { size: 12, gapBefore: 14, gapAfter: 6 });
    if (!probe) {
      drawText('Probe result not available on this request.', { size: 10.5, color: MUTED, leading: 1.5 });
      continue;
    }
    /** @type {string} */
    const verdict = probe.applies === true
      ? 'IN SCOPE'
      : probe.applies === false
        ? 'OUT OF SCOPE'
        : probe.applies === 'maybe'
          ? 'VERIFY'
          : 'UNKNOWN';
    const verdictColor = probe.applies === true
      ? rgb(0.85, 0.45, 0.04)
      : probe.applies === false
        ? rgb(0.04, 0.6, 0.4)
        : MUTED;
    drawKv('Verdict', verdict, { valueFont: fontBold, valueColor: verdictColor });
    if (probe.reason) drawText(String(probe.reason), { size: 10.5, leading: 1.55 });
    if (probe.citation) drawText(probe.citation, { f: fontItalic, size: 10, color: MUTED, leading: 1.4 });
    if (probe.confidence) drawKv('Confidence', String(probe.confidence).toUpperCase());
  }

  // ── Landed-cost quote summary ─────────────────────────────────

  drawHeading('Landed-cost quote summary', { color: AQUA });
  const quote = request.landedQuote;
  if (quote && Array.isArray(quote.components)) {
    for (const c of quote.components) {
      drawKv(c.label || c.component || '-', 'EUR ' + (Number(c.eurCents) / 100).toFixed(2));
    }
    gap(4);
    drawHairline();
    gap(8);
    drawKv('Total landed', 'EUR ' + (Number(quote.totalLandedCents) / 100).toFixed(2), {
      valueFont: fontBold,
    });
    drawKv('Confidence tier', String(quote.confidenceTier || '-').toUpperCase());
    if (quote.confidenceNotes && quote.confidenceNotes.length) {
      gap(4);
      for (const note of quote.confidenceNotes) {
        drawText('· ' + String(note), { f: fontItalic, size: 10, color: MUTED, leading: 1.45 });
      }
    }
  } else {
    drawText('No landed quote on this request yet.', { size: 10.5, color: MUTED, leading: 1.5 });
  }

  // ── Disclaimer callout ────────────────────────────────────────

  gap(14);
  drawCalloutBox(
    '#ecfeff',
    'Disclaimer',
    'This dossier represents OrcaTrade\'s calculator-grounded compliance assessment as of ' +
    (generatedAt || new Date().toISOString().slice(0, 10)) +
    '. Duty rates, applicability verdicts, and regulation references are based on the customer\'s stated intent + the resolved HS classification. ' +
    'Final classification for customs filing requires confirmation against the 8-10 digit TARIC code by your customs broker, supported by a Binding Tariff Information (BTI) ruling for high-volume SKUs. OrcaTrade does not warrant fitness for filing without verification.',
  );

  drawFooter();
  return await doc.save();
}

module.exports = {
  generateComplianceDossier,
};
