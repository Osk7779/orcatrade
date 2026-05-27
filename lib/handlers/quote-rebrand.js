'use strict';

// Quote Studio — supplier quotation → branded OrcaTrade quotation (Sprint
// quote-rebrand-v1). Internal team tool, admin-gated.
//
// Two actions, both POST /api/quote-rebrand:
//
//   action:'extract'  { pdfBase64, filename? }
//     → sends the supplier PDF to Claude purely to READ it, returns the raw
//       line items as structured JSON for the team to review/correct. The LLM
//       never prices anything — see the calculator-grounded hard rule.
//
//   action:'generate' { currency, marginPct, lineItems, meta }
//     → runs the deterministic margin calculator, renders a branded PDF, writes
//       the audit log, and returns the PDF bytes (application/pdf).
//
// The review step lives between the two on the client (/tools/quote-rebrand/),
// so extraction errors never silently propagate into a customer-facing quote.

const { verifyAdmin } = require('../admin-auth');
const { consumeRateLimit } = require('../intelligence/runtime-store');
const { requestAnthropicMessage, extractAnthropicText } = require('../intelligence/model-runtime');
const { MODELS } = require('../ai/models');
const { calculateRebrandedQuote } = require('../intelligence/rebrand-quote');
const { buildQuotePdf } = require('../intelligence/quote-pdf');
const events = require('../events');
const log = require('../log');

// Base64 of a PDF this big (after ~33% inflation) stays under Vercel's body
// cap; supplier quotes are 1–4 pages. Reject early with a clear message rather
// than letting the platform truncate.
const MAX_PDF_BYTES = 8 * 1024 * 1024;

const EXTRACT_TIMEOUT_MS = 60000;
const EXTRACT_MAX_TOKENS = 4000;

const EXTRACT_SYSTEM = `You are a precise data-extraction tool for an import-operations company. You are given a supplier's quotation as a PDF. Extract its commercial line items and metadata EXACTLY as written — never invent, infer, convert, or re-price anything. If a value is absent, use null. Return ONLY a single JSON object, no prose, no markdown fences, matching this shape:
{
  "supplierName": string|null,
  "currency": string|null,        // ISO-4217 if determinable, e.g. "USD", "CNY", "EUR"
  "incoterms": string|null,        // e.g. "FOB Shenzhen"
  "validity": string|null,         // supplier's own quote validity, verbatim
  "lineItems": [
    { "description": string, "quantity": number, "unit": string|null, "unitPrice": number }
  ],
  "notes": string|null             // anything material: MOQ, lead time, payment terms
}
Rules: unitPrice and quantity are plain numbers (dot decimal, no thousands separators, no currency symbol). Preserve the supplier's per-unit pricing — if the document only gives a line total, divide by quantity for unitPrice and note it. Do not include tax/shipping lines as products; put them in notes.`;

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function parseExtractionJson(rawText) {
  const text = String(rawText || '').trim();
  // Tolerate a stray ```json fence even though the prompt forbids it.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  // Grab the outermost {...} so leading/trailing prose can't break JSON.parse.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

async function handleExtract(req, res, ip) {
  const rate = await consumeRateLimit('quote-rebrand-extract', ip, 20, 60000);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many extractions. Please wait a moment.' });
  }

  const body = readBody(req);
  const pdfBase64 = typeof body.pdfBase64 === 'string' ? body.pdfBase64.replace(/^data:application\/pdf;base64,/, '').trim() : '';
  if (!pdfBase64) {
    return res.status(400).json({ error: '`pdfBase64` is required' });
  }
  // Rough byte estimate from base64 length (4 chars → 3 bytes).
  if (pdfBase64.length * 0.75 > MAX_PDF_BYTES) {
    return res.status(413).json({ error: 'PDF is too large (max 8 MB). Please send a smaller file.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ORCATRADE_OS_API;
  if (!apiKey) {
    return res.status(503).json({ error: 'Extraction requires ANTHROPIC_API_KEY. You can still enter line items manually and generate.' });
  }

  try {
    const { data } = await requestAnthropicMessage({
      apiKey,
      model: MODELS.BULK, // mechanical extraction — a human reviews before it prices anything
      maxTokens: EXTRACT_MAX_TOKENS,
      system: EXTRACT_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: 'Extract the quotation per your instructions. Return only the JSON object.' },
        ],
      }],
      timeoutMs: EXTRACT_TIMEOUT_MS,
      retries: 1,
    });

    const parsed = parseExtractionJson(extractAnthropicText(data));
    if (!parsed) {
      return res.status(502).json({ error: 'Could not read the quotation automatically. Enter the line items manually.' });
    }

    // Normalise to the shape the review form / calculator expect. We do NOT
    // trust or use any computed totals from the model — only the raw rows.
    const lineItems = Array.isArray(parsed.lineItems) ? parsed.lineItems.map((li) => ({
      description: li && li.description != null ? String(li.description) : '',
      quantity: li && li.quantity != null ? li.quantity : '',
      unit: li && li.unit != null ? String(li.unit) : '',
      unitPrice: li && li.unitPrice != null ? li.unitPrice : '',
    })) : [];

    return res.status(200).json({
      ok: true,
      extraction: {
        supplierName: parsed.supplierName || null,
        currency: parsed.currency || null,
        incoterms: parsed.incoterms || null,
        validity: parsed.validity || null,
        notes: parsed.notes || null,
        lineItems,
      },
      reviewRequired: true,
    });
  } catch (err) {
    log.error('quote-rebrand extract failed', { requestId: req.requestId, err });
    return res.status(502).json({ error: 'Automatic extraction failed. Enter the line items manually and generate.' });
  }
}

async function handleGenerate(req, res, ip, verdict) {
  const rate = await consumeRateLimit('quote-rebrand-generate', ip, 30, 60000);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many generations. Please wait a moment.' });
  }

  const body = readBody(req);
  const quote = calculateRebrandedQuote({
    currency: body.currency,
    marginPct: body.marginPct,
    lineItems: body.lineItems,
  });
  if (!quote.ok) {
    return res.status(400).json({ error: 'Validation failed', errors: quote.errors });
  }

  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  let pdfBytes;
  try {
    pdfBytes = await buildQuotePdf({ quote, meta });
  } catch (err) {
    log.error('quote-rebrand pdf render failed', { requestId: req.requestId, err });
    return res.status(500).json({ error: 'Failed to render the PDF.' });
  }

  // Audit before returning success (mutation-audit hard rule). Shape only —
  // no customer PII beyond the actor email, which events.js hashes for Postgres.
  await events.record('quote_rebrand_generated', {
    email: verdict.mode === 'session' ? verdict.email : undefined,
    actorMode: verdict.mode,
    quoteNumber: meta.quoteNumber || null,
    currency: quote.currency,
    marginPct: quote.marginPct,
    lineCount: quote.lines.length,
    totalCents: quote.totalCents,
    supplierSubtotalCents: quote.internal.supplierSubtotalCents,
    marginAmountCents: quote.internal.marginAmountCents,
  });

  const safeNum = String(meta.quoteNumber || 'quote').replace(/[^A-Za-z0-9_-]/g, '') || 'quote';
  const buffer = Buffer.from(pdfBytes);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="orcatrade-${safeNum}.pdf"`);
  res.setHeader('Content-Length', String(buffer.length));
  res.statusCode = 200;
  return res.end(buffer);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Internal tool — gate on the founder session cookie or the admin token.
  const verdict = await verifyAdmin(req);
  if (!verdict.ok) {
    return res.status(verdict.statusCode).json({ error: verdict.error });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const body = readBody(req);
  const action = body.action;

  if (action === 'extract') return handleExtract(req, res, ip);
  if (action === 'generate') return handleGenerate(req, res, ip, verdict);

  return res.status(400).json({ error: "`action` must be 'extract' or 'generate'" });
};
