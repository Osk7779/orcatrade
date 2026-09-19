// scripts/generate-partner-brief.js — quick partner-facing one-pager.
// Run: node scripts/generate-partner-brief.js
// Output: docs/partner-brief.pdf

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs', 'partner-brief.pdf');

// Brand colours (matching app-shell --color-aqua direction)
const AQUA = rgb(0.133, 0.827, 0.933);  // #22d3ee
const INK = rgb(0.04, 0.04, 0.04);
const MUTED = rgb(0.35, 0.35, 0.4);
const HAIRLINE = rgb(0.85, 0.85, 0.88);

// Page geometry (A4 in points)
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_L = 60;
const MARGIN_R = 60;
const MARGIN_T = 64;
const MARGIN_B = 64;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN_T;

  // Helper — wrap text to width, return array of lines.
  function wrap(text, f, size, maxW) {
    const words = String(text).split(/\s+/);
    /** @type {string[]} */
    const lines = [];
    let line = '';
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      const w = f.widthOfTextAtSize(trial, size);
      if (w > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function ensureSpace(needed) {
    if (y - needed < MARGIN_B) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN_T;
    }
  }

  function drawText(text, { f = font, size = 11, color = INK, leading = 1.45 } = {}) {
    const lines = wrap(text, f, size, CONTENT_W);
    const lineH = size * leading;
    ensureSpace(lines.length * lineH);
    for (const line of lines) {
      page.drawText(line, { x: MARGIN_L, y, size, font: f, color });
      y -= lineH;
    }
  }

  function gap(h) { y -= h; }

  function drawHairline({ color = HAIRLINE, weight = 0.5, w = CONTENT_W } = {}) {
    page.drawRectangle({
      x: MARGIN_L, y, width: w, height: weight, color,
    });
    y -= weight;
  }

  function drawHeading(text, { size = 14, color = INK, gapBefore = 22, gapAfter = 10 } = {}) {
    gap(gapBefore);
    const lineH = size * 1.35;
    ensureSpace(lineH + gapAfter);
    // Convention: y is the baseline of the next line to be drawn (matches drawText).
    // Previous code drew at y - size which placed the heading INSIDE the gap above
    // it, leaving no buffer between the heading and the body text below.
    page.drawText(text, { x: MARGIN_L, y, size, font: fontBold, color });
    y -= lineH + gapAfter;
  }

  function drawBullet(text, { size = 11, leading = 1.45, indent = 14 } = {}) {
    const bulletX = MARGIN_L;
    const textX = MARGIN_L + indent;
    const textW = CONTENT_W - indent;
    const lines = wrap(text, font, size, textW);
    const lineH = size * leading;
    ensureSpace(lines.length * lineH);
    page.drawText('—', { x: bulletX, y, size, font, color: AQUA });
    page.drawText(lines[0], { x: textX, y, size, font, color: INK });
    y -= lineH;
    for (let i = 1; i < lines.length; i++) {
      page.drawText(lines[i], { x: textX, y, size, font, color: INK });
      y -= lineH;
    }
  }

  // ─── Title block ──────────────────────────────────────────────

  // Aqua hairline strip across the top
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: AQUA });

  // Wordmark
  page.drawText('OrcaTrade', {
    x: MARGIN_L, y: PAGE_H - MARGIN_T - 6,
    size: 28, font: fontBold, color: INK,
  });
  page.drawText('Operations', {
    x: MARGIN_L + fontBold.widthOfTextAtSize('OrcaTrade', 28) + 12,
    y: PAGE_H - MARGIN_T - 6,
    size: 18, font, color: AQUA,
  });
  y = PAGE_H - MARGIN_T - 30;

  // Eyebrow
  page.drawText('PARTNER BRIEFING', {
    x: MARGIN_L, y,
    size: 9, font: fontBold, color: MUTED,
  });
  y -= 16;

  // Tagline
  drawText('AI-native operating system for European SMEs importing from Asia.', {
    size: 14, leading: 1.35, color: INK,
  });

  gap(14);
  drawHairline();
  gap(18);

  // ─── What this is ─────────────────────────────────────────────

  drawHeading('What this is', { color: AQUA, gapBefore: 4 });
  drawText(
    'OrcaTrade is the trade-operations team available 24/7. The platform collapses the operational layer of cross-border trade — sourcing, customs, freight, finance, compliance — into a single managed service. The customer expresses intent in plain English; the platform produces a factory shortlist, a fully landed-cost quote, and end-to-end fulfilment. Headquartered in London with offices in Warsaw and Hong Kong; pre-revenue, pre-seed.',
    { size: 11, leading: 1.5 },
  );

  // ─── The strategic shift ──────────────────────────────────────

  drawHeading('The shift', { size: 14, color: AQUA });
  drawText(
    'OrcaTrade is making a deliberate move: from a software-only trade advisor to a regulated counterparty operating an AI-driven trade desk for SMEs. The premise is simple. AI capable of doing SME-grade office work collapses the unit economics of serving small importers from uneconomic to profitable. We capture a take-rate on cargo (6–10% combined: broker + IOR + FX + finance + compliance) rather than seat licences. Software is the wedge; take-rate is the business.',
    { size: 11, leading: 1.5 },
  );

  // ─── Four-layer architecture ──────────────────────────────────

  drawHeading('The four-layer architecture', { size: 14, color: AQUA });
  drawBullet('Operator — managed-import-as-a-service. Customer says what they want from Asia; we deliver to their warehouse. One number, one accountable party. This is what is live today.');
  gap(2);
  drawBullet('Marketplace — two-sided take-rate. Factories pay for verified-buyer access; SMEs pay for managed import. A proprietary trade-credit graph builds from shipment ground truth no competitor owns.');
  gap(2);
  drawBullet('Embedded Rail — "Import from China" API embedded in Shopify, Amazon, banks, ERPs, and Chinese factory direct-sales. Distribution cost approaches zero. This is the leap to a billion-dollar revenue line.');
  gap(2);
  drawBullet('Adjacent Platforms — cargo insurance, revolving trade credit, VAT/duty deferment, EU brand-of-record service. Each rides on the same customer + data + licence base.');

  // ─── What is live ─────────────────────────────────────────────

  drawHeading('What is live today', { size: 14, color: AQUA });
  drawText(
    'The Operator surface ships end-to-end. The customer expresses intent. The AI generates a factory shortlist, a calculator-grounded landed-cost quote (duty + VAT + freight + finance + transparent take-rate), and a plain-English summary that cites only calculator outputs — never invents a number. CBAM, EUDR, and REACH compliance applicability surfaces before approval. The team reviews via a human-in-the-loop gate. On approval, downstream Goods + Supplier + Shipment entities materialise automatically; ops gets a notification to begin fulfilment.',
    { size: 11, leading: 1.5 },
  );
  gap(6);
  drawText(
    'Five specialist agents (compliance, sourcing, logistics, finance, orchestrator) sit on top of deterministic calculators. The discipline is non-negotiable: LLMs never produce a number that drives a decision. Every monetary value traces to a calculator and a regulation citation.',
    { size: 11, leading: 1.5 },
  );

  // ─── How we scale to a billion-dollar company ─────────────────

  drawHeading('How we scale to a billion-dollar company', { color: AQUA });
  drawText(
    'The market. EU SMEs spend roughly €200 billion a year importing from Asia. The total cost of importing — duty, VAT, freight, customs broker, FX, working capital, insurance, compliance — is 15–25% of cargo value, a €30–50 billion fee pool sitting on top of the goods themselves. OrcaTrade captures a take-rate on that fee pool. A 1–2% blended take is a €300M–1B revenue line. The legacy customs broker + freight forwarder + invoice financier stack cannot economically serve sub-€5M-revenue SMEs because the per-shipment human cost exceeds the per-shipment margin. AI-native operations collapse that cost — where Flexport runs ~1,500 people to handle enterprise freight, OrcaTrade is built to run an order of magnitude leaner because the orchestrator does the operations work.',
    { size: 11, leading: 1.5 },
  );
  gap(6);
  drawText(
    'Unit economics on a €100,000 shipment. ~1.5% broker + 2% IOR + 1% FX + 4% trade-finance + 0.5% compliance = ~9% blended take = €9,000 per shipment. An SME importing €2M of cargo a year yields €180,000 of OrcaTrade revenue. 5,000 such customers is €900M ARR. There are well over 100,000 EU SMEs importing meaningful cargo from Asia today.',
    { size: 11, leading: 1.5 },
  );
  gap(8);
  drawText('The four-layer compounding.', { f: fontBold, size: 11, leading: 1.4 });
  gap(2);
  drawBullet('Layer 1 (Operator). Software-services hybrid. Caps at roughly €30–100M ARR.');
  gap(2);
  drawBullet('Layer 2 (Marketplace). Two-sided take + proprietary trade-credit data. €200–500M ARR.');
  gap(2);
  drawBullet('Layer 3 (Embedded Rail). The import button inside Shopify, Amazon, banks, ERPs, and large Chinese factory portals. Distribution cost approaches zero. €1B+ ARR.');
  gap(2);
  drawBullet('Layer 4 (Adjacent Platforms). Public-company range — insurance, revolving credit, brand-of-record. Same customer + data + licence base, monetised more ways.');
  gap(8);
  drawText('Capital architecture.', { f: fontBold, size: 11, leading: 1.4 });
  gap(2);
  drawBullet('Equity track. Pre-seed, seed, Series A, B, C, IPO. Investors fund the path to each new layer.');
  gap(2);
  drawBullet('Debt track. A separate warehouse line + credit facility funds the trade-finance book once the loss rate proves out. Debt scales faster than equity from year 3 onwards — the same shape every vertical fintech with a balance sheet (Stenn, Mercury, Brex) follows.');
  gap(8);
  drawText('Where partners win.', { f: fontBold, size: 11, leading: 1.4 });
  gap(2);
  drawText(
    'Every layer is built on partner relationships before being absorbed. A broker partner in year 1 becomes a co-volume relationship as we approach licence acquisition. A freight-forwarder partner is locked in as the preferred carrier on our embedded rail. A trade-financier partner gets first refusal on receivables before our own facility scales. Partners are not interim suppliers — they are co-builders of a category.',
    { size: 11, leading: 1.5 },
  );

  // ─── How partners fit in ──────────────────────────────────────

  drawHeading('How partners fit in', { size: 14, color: AQUA });
  drawText(
    'OrcaTrade stands on partner relationships in the early stages. We bring the customer, the AI workflow, the compliance discipline, the brand. Partners bring the regulated licences, the operational reach, the balance-sheet capacity. The model evolves: early sprints lean heavily on partners; later sprints absorb licences and balance sheet as volume justifies. We are actively looking for partners in:',
    { size: 11, leading: 1.5 },
  );
  gap(6);
  drawBullet('Customs brokerage in EU member states (DE, NL, BE, PL, FR, IE preferred for v1 corridor coverage)');
  gap(2);
  drawBullet('Freight forwarding into the EU from China, Vietnam, India, Bangladesh, Türkiye');
  gap(2);
  drawBullet('Trade-finance capacity — CNY pre-payment to the factory, EUR receivable terms to the importer');
  gap(2);
  drawBullet('FX / payment rails (a Wise-Business-style EUR-to-CNY corridor with thin spreads)');
  gap(2);
  drawBullet('Cargo inspection (SGS-equivalent for verified pre-shipment quality)');

  // ─── Where we are going ───────────────────────────────────────

  drawHeading('Where we are going', { size: 14, color: AQUA });
  drawBullet('Year 1 — 10 to 50 managed-import customers, partner-stacked operations, brand built on zero customs errors and zero hallucinated numbers.');
  gap(2);
  drawBullet('Year 3 — 1,000+ customers, marketplace flywheel turned on, own customs-broker licence in at least one EU corridor.');
  gap(2);
  drawBullet('Year 5 — embedded distribution, partner-of-record for a major commerce platform, balance-sheet trade-finance arm.');

  // ─── Contact ──────────────────────────────────────────────────

  gap(18);
  drawHairline();
  gap(14);
  drawText('OrcaTrade Group Ltd · London · Warsaw · Hong Kong', {
    f: fontBold, size: 11, color: INK, leading: 1.4,
  });
  drawText('oskar@orcatrade.pl · orcatrade.pl', {
    f: fontItalic, size: 10, color: MUTED, leading: 1.4,
  });

  // ─── Save ─────────────────────────────────────────────────────

  const bytes = await doc.save();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, bytes);

  const totalKb = (bytes.length / 1024).toFixed(1);
  console.log(`✓ Wrote ${OUTPUT_PATH} (${totalKb} KB, ${doc.getPageCount()} page${doc.getPageCount() === 1 ? '' : 's'})`);
})().catch((err) => {
  console.error('PDF generation failed:', err);
  process.exit(1);
});
