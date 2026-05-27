'use strict';

// Branded OrcaTrade quotation PDF renderer (Sprint quote-rebrand-v1).
//
// Deterministic document rendering — no LLM, no numbers invented here. It takes
// a priced quote from rebrand-quote.js plus presentation metadata and lays out
// a professional A4 quotation in the OrcaTrade palette, returning raw PDF bytes.
//
// Engine choice: pdf-lib (pure JS). Picked over headless Chromium because it
// runs natively in the Vercel function runtime with no Chromium binary, no cold
// start penalty, and full control over the layout. The orca mark is embedded
// from icons/orca-192.png (42KB) rather than the 1.4MB wordmark so generated
// PDFs stay small.

const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// ── Brand palette (from css/styles.css) ──────────────────────────────────
const NAVY = rgb(0.02, 0.02, 0.027);   // #050507
const INK = rgb(0.07, 0.07, 0.08);
const MUTED = rgb(0.42, 0.45, 0.49);    // ~ --gold-soft
const GOLD = rgb(0.72, 0.745, 0.784);   // #b8bec8
const HAIRLINE = rgb(0.85, 0.86, 0.88);
const HEADER_TEXT = rgb(0.93, 0.93, 0.93); // --cream

// A4 in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = 48;

// Column geometry for the line-item table (x offsets from left margin).
const COL = {
  desc: 0,
  qty: CONTENT_W - 250,
  unit: CONTENT_W - 165,
  amount: CONTENT_W, // right edge — amounts are right-aligned to here
};

let cachedMark = null;
function loadMarkBytes() {
  if (cachedMark !== null) return cachedMark;
  try {
    cachedMark = fs.readFileSync(path.join(process.cwd(), 'icons', 'orca-192.png'));
  } catch (_) {
    cachedMark = false; // render without a mark rather than fail the quote
  }
  return cachedMark;
}

function sanitise(text) {
  // StandardFonts are WinAnsi — strip codepoints they can't encode so a stray
  // emoji or CJK char in a supplier description never throws mid-render.
  return String(text == null ? '' : text).replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

// Greedy word-wrap to a pixel width, returns an array of lines.
function wrapText(text, font, size, maxWidth) {
  const words = sanitise(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

async function buildQuotePdf({ quote, meta }) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const doc = await PDFDocument.create();
  doc.setTitle(`OrcaTrade Quotation ${m.quoteNumber || ''}`.trim());
  doc.setProducer('OrcaTrade');
  doc.setCreator('OrcaTrade Quote Studio');

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const markBytes = loadMarkBytes();
  const mark = markBytes ? await doc.embedPng(markBytes) : null;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const text = (s, x, yy, { font = helv, size = 9, color = INK } = {}) =>
    page.drawText(sanitise(s), { x, y: yy, size, font, color });

  // right-aligned text helper (x is the right edge)
  const textRight = (s, xRight, yy, { font = helv, size = 9, color = INK } = {}) => {
    const str = sanitise(s);
    const w = font.widthOfTextAtSize(str, size);
    page.drawText(str, { x: xRight - w, y: yy, size, font, color });
  };

  const drawFooter = (pageNum, pageCount) => {
    page.drawLine({
      start: { x: MARGIN, y: FOOTER_Y + 14 },
      end: { x: PAGE_W - MARGIN, y: FOOTER_Y + 14 },
      thickness: 0.5,
      color: HAIRLINE,
    });
    text(
      m.footerNote || 'This quotation is valid for the period stated above. Prices are inclusive of OrcaTrade service and handling. E&OE.',
      MARGIN, FOOTER_Y, { size: 7, color: MUTED }
    );
    textRight(`Page ${pageNum} of ${pageCount}`, PAGE_W - MARGIN, FOOTER_Y, { size: 7, color: MUTED });
  };

  // ── Header band ─────────────────────────────────────────────────────────
  const markSize = 34;
  if (mark) {
    const dims = mark.scaleToFit(markSize, markSize);
    page.drawImage(mark, { x: MARGIN, y: y - markSize + 4, width: dims.width, height: dims.height });
  }
  text('ORCATRADE', MARGIN + (mark ? markSize + 10 : 0), y - 16, { font: helvBold, size: 19, color: NAVY });
  text('Trade compliance & import operations', MARGIN + (mark ? markSize + 10 : 0), y - 28, { size: 8, color: MUTED });

  textRight('QUOTATION', PAGE_W - MARGIN, y - 6, { font: helvBold, size: 13, color: NAVY });
  textRight(m.quoteNumber ? `No. ${m.quoteNumber}` : '', PAGE_W - MARGIN, y - 20, { size: 9, color: MUTED });
  const issued = m.issueDate || new Date().toISOString().slice(0, 10);
  textRight(`Issued ${issued}`, PAGE_W - MARGIN, y - 32, { size: 9, color: MUTED });

  y -= markSize + 16;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.5, color: GOLD });
  y -= 26;

  // ── From / To blocks ──────────────────────────────────────────────────────
  const colGap = 24;
  const blockW = (CONTENT_W - colGap) / 2;
  const from = m.from && typeof m.from === 'object' ? m.from : {};
  const fromLines = [
    from.name || 'OrcaTrade',
    ...(Array.isArray(from.lines) ? from.lines : ['EU import operations']),
    from.email || '',
    from.vat ? `VAT ${from.vat}` : '',
  ].filter(Boolean);
  const toLines = [
    m.customerName || '—',
    ...String(m.customerAddress || '').split('\n').map((s) => s.trim()).filter(Boolean),
  ];

  const labelY = y;
  text('FROM', MARGIN, labelY, { font: helvBold, size: 7.5, color: MUTED });
  text('PREPARED FOR', MARGIN + blockW + colGap, labelY, { font: helvBold, size: 7.5, color: MUTED });
  y -= 14;
  const blockTop = y;
  fromLines.forEach((line, i) => text(line, MARGIN, blockTop - i * 12, { size: 9, font: i === 0 ? helvBold : helv }));
  toLines.forEach((line, i) => text(line, MARGIN + blockW + colGap, blockTop - i * 12, { size: 9, font: i === 0 ? helvBold : helv }));
  y = blockTop - Math.max(fromLines.length, toLines.length) * 12 - 16;

  // ── Meta strip (valid until / currency) ────────────────────────────────────
  const metaItems = [
    ['VALID UNTIL', m.validUntil || '—'],
    ['CURRENCY', quote.currency],
    ['LINE ITEMS', String(quote.lines.length)],
  ];
  const metaW = CONTENT_W / metaItems.length;
  page.drawRectangle({ x: MARGIN, y: y - 30, width: CONTENT_W, height: 34, color: rgb(0.97, 0.97, 0.965) });
  metaItems.forEach(([label, value], i) => {
    const cx = MARGIN + i * metaW + 12;
    text(label, cx, y - 8, { font: helvBold, size: 7, color: MUTED });
    text(value, cx, y - 22, { size: 10, font: helvBold, color: INK });
  });
  y -= 30 + 24;

  // ── Line-item table header ──────────────────────────────────────────────
  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 18, width: CONTENT_W, height: 22, color: NAVY });
    const hy = y - 13;
    text('DESCRIPTION', MARGIN + 8, hy, { font: helvBold, size: 8, color: HEADER_TEXT });
    textRight('QTY', MARGIN + COL.unit - 12, hy, { font: helvBold, size: 8, color: HEADER_TEXT });
    textRight('UNIT PRICE', MARGIN + COL.amount - 80, hy, { font: helvBold, size: 8, color: HEADER_TEXT });
    textRight('AMOUNT', MARGIN + COL.amount - 8, hy, { font: helvBold, size: 8, color: HEADER_TEXT });
    y -= 18 + 8;
  };
  drawTableHeader();

  // ── Line-item rows (paginated) ──────────────────────────────────────────
  const ROW_PAD = 6;
  const LINE_H = 11;
  for (const line of quote.lines) {
    const descLines = wrapText(line.description, helv, 9, COL.qty - 12);
    const rowH = descLines.length * LINE_H + ROW_PAD * 2;

    // Page break if this row would collide with the footer.
    if (y - rowH < FOOTER_Y + 30) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawTableHeader();
    }

    const rowTop = y;
    descLines.forEach((dl, i) => text(dl, MARGIN + 8, rowTop - ROW_PAD - 9 - i * LINE_H, { size: 9 }));
    const firstLineY = rowTop - ROW_PAD - 9;
    const qtyLabel = line.unit ? `${line.quantity} ${line.unit}` : String(line.quantity);
    textRight(qtyLabel, MARGIN + COL.unit - 12, firstLineY, { size: 9 });
    textRight(line.unitPriceDisplay, MARGIN + COL.amount - 80, firstLineY, { size: 9 });
    textRight(line.lineTotalDisplay, MARGIN + COL.amount - 8, firstLineY, { size: 9, font: helvBold });

    y = rowTop - rowH;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: HAIRLINE });
  }

  // ── Total ────────────────────────────────────────────────────────────────
  y -= 14;
  if (y < FOOTER_Y + 50) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }
  const totalBoxX = MARGIN + CONTENT_W - 230;
  page.drawRectangle({ x: totalBoxX, y: y - 26, width: 230, height: 30, color: NAVY });
  text('TOTAL', totalBoxX + 12, y - 17, { font: helvBold, size: 10, color: HEADER_TEXT });
  textRight(quote.totalDisplay, MARGIN + COL.amount - 8, y - 17, { font: helvBold, size: 12, color: HEADER_TEXT });
  y -= 26 + 8;
  textRight(`All prices in ${quote.currency}. Inclusive of OrcaTrade service & handling.`,
    PAGE_W - MARGIN, y, { size: 7.5, color: MUTED });
  y -= 24;

  // ── Notes ──────────────────────────────────────────────────────────────────
  if (m.notes && String(m.notes).trim()) {
    if (y < FOOTER_Y + 90) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    text('NOTES', MARGIN, y, { font: helvBold, size: 7.5, color: MUTED });
    y -= 14;
    for (const nl of wrapText(m.notes, helv, 9, CONTENT_W)) {
      text(nl, MARGIN, y, { size: 9, color: INK });
      y -= 12;
    }
  }

  // Footer on every page.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    drawFooter(i + 1, pages.length);
  });

  return doc.save();
}

module.exports = { buildQuotePdf };
