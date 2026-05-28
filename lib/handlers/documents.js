// Trade Documentation Hub generator endpoint.
// Accepts { type, data } and returns rendered HTML for download / print / preview.

const { consumeRateLimit } = require('../intelligence/runtime-store');
const { generateDocument, listDocumentTypes, draftFromPlan } = require('../intelligence/document-generator');
const { auditDocument } = require('../intelligence/document-audit');
const { extractFields } = require('../intelligence/document-extract');
const auth = require('../auth');
const savedPlans = require('../saved-plans');
const draftStore = require('../draft-store');
const events = require('../events');

const DOC_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
    color: #111;
    background: #f6f5f1;
    padding: 2.5rem 1.5rem;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .doc-shell {
    max-width: 880px;
    margin: 0 auto;
    background: #fff;
    padding: 3rem 3rem 4rem;
    box-shadow: 0 12px 40px rgba(0,0,0,0.08);
    border: 1px solid rgba(0,0,0,0.08);
    position: relative;
  }
  .doc-shell::before {
    content: "OrcaTrade · Generated " attr(data-generated);
    position: absolute;
    top: 0.6rem; right: 1rem;
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(0,0,0,0.35);
  }
  .doc-h1 {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.9rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin-bottom: 1.2rem;
    border-bottom: 2px solid #111;
    padding-bottom: 0.6rem;
  }
  .doc-sub {
    font-size: 0.78rem;
    color: rgba(0,0,0,0.55);
    margin-bottom: 1.4rem;
    line-height: 1.55;
  }
  .party-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    margin-bottom: 1.5rem;
    background: rgba(0,0,0,0.08);
    border: 1px solid rgba(0,0,0,0.08);
  }
  .party-block {
    background: #fff;
    padding: 1rem 1.1rem;
    min-height: 7rem;
  }
  .party-block.placeholder { background: rgba(0,0,0,0.02); }
  .party-label {
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(0,0,0,0.55);
    margin-bottom: 0.55rem;
  }
  .party-body { font-size: 0.83rem; line-height: 1.55; }
  .party-body div { margin-bottom: 0.15rem; }
  .bar-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    margin-bottom: 1.5rem;
    background: rgba(0,0,0,0.08);
    border: 1px solid rgba(0,0,0,0.08);
  }
  .bar-cell { background: #fff; padding: 0.6rem 0.8rem; }
  .bar-label {
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(0,0,0,0.55);
    margin-bottom: 0.25rem;
  }
  .bar-value { font-size: 0.85rem; font-weight: 500; }
  .line-table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0 1.5rem;
    font-size: 0.85rem;
  }
  .line-table th, .line-table td {
    padding: 0.6rem 0.7rem;
    border-bottom: 1px solid rgba(0,0,0,0.08);
    text-align: left;
    vertical-align: top;
  }
  .line-table th {
    background: #f3f1ec;
    font-weight: 600;
    font-size: 0.74rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(0,0,0,0.7);
    border-bottom: 2px solid #111;
  }
  .line-table tfoot td {
    border-top: 2px solid #111;
    border-bottom: none;
    padding-top: 0.7rem;
  }
  .line-table .num { text-align: right; }
  .line-table .total { font-size: 1rem; }
  .line-desc { font-weight: 500; }
  .line-meta { font-size: 0.74rem; color: rgba(0,0,0,0.55); margin-top: 0.15rem; }
  .banking-block, .notes-block, .declaration-block {
    margin-top: 1.2rem;
    padding: 0.9rem 1rem;
    background: #f7f5f0;
    border-left: 3px solid #111;
    font-size: 0.84rem;
    line-height: 1.6;
  }
  .block-label {
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(0,0,0,0.55);
    margin-bottom: 0.35rem;
  }
  .block-body { white-space: pre-wrap; }
  .signature-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.5rem;
    margin-top: 2.5rem;
  }
  .signature-block { font-size: 0.78rem; }
  .signature-label {
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(0,0,0,0.55);
    margin-bottom: 1.2rem;
  }
  .signature-line { border-bottom: 1px solid #111; height: 2rem; margin-bottom: 0.4rem; }
  .signature-stamp { border: 1px dashed rgba(0,0,0,0.35); height: 5rem; }
  .signature-meta { color: rgba(0,0,0,0.65); margin-top: 0.3rem; font-size: 0.74rem; }
  .toolbar {
    max-width: 880px;
    margin: 0 auto 1rem;
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
    align-items: center;
    color: #444;
    font-size: 0.78rem;
  }
  .toolbar a, .toolbar button {
    background: #111; color: #fff;
    padding: 0.55rem 1rem;
    border: none;
    font-family: inherit;
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    text-decoration: none;
  }
  .toolbar button.ghost { background: #fff; color: #111; border: 1px solid #111; }
  .toolbar a:hover, .toolbar button:hover { filter: brightness(1.1); }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar { display: none; }
    .doc-shell { box-shadow: none; border: none; padding: 0; }
    .doc-shell::before { display: none; }
  }
`;

function buildShell({ html, type, generatedAt }) {
  const safeType = String(type || 'document').replace(/[^a-z_-]/gi, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${safeType} — OrcaTrade</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<style>${DOC_STYLES}</style>
</head>
<body>
<div class="toolbar">
  <span>Trade Documentation Hub · ${safeType.replace(/_/g, ' ')}</span>
  <div style="display: flex; gap: 0.5rem;">
    <button onclick="window.print()">Print / Save as PDF</button>
    <a href="javascript:history.back()" class="ghost" style="background: #fff; color: #111; border: 1px solid #111; padding: 0.55rem 1rem; text-decoration: none;">Back to form</a>
  </div>
</div>
<div class="doc-shell" data-generated="${generatedAt}">
  ${html}
</div>
</body>
</html>`;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET → list available document types, or (for signed-in users) list mine,
  // or fetch one of mine by id + render its HTML for preview.
  if (req.method === 'GET') {
    const qAction = String((req.query && req.query.action) || '').toLowerCase();
    if (qAction === 'list-mine') {
      const user = auth.getCurrentUser(req);
      if (!user) return res.status(401).json({ error: 'Sign in to list your drafts.' });
      const status = req.query && req.query.status ? String(req.query.status) : undefined;
      const drafts = await draftStore.listDrafts(user.email, { status });
      // Strip the bulky `data` from the list response — clients fetch one by id
      // when they need to preview/render it.
      const lean = drafts.map(({ data, email, ...rest }) => rest); // eslint-disable-line no-unused-vars
      return res.status(200).json({ ok: true, drafts: lean });
    }
    if (qAction === 'get') {
      const user = auth.getCurrentUser(req);
      if (!user) return res.status(401).json({ error: 'Sign in to fetch a draft.' });
      const id = String((req.query && req.query.id) || '');
      const rec = await draftStore.getDraft(id, user.email);
      if (!rec) return res.status(404).json({ error: 'Draft not found' });
      const result = generateDocument(rec.type, rec.data);
      if (!result.ok) {
        return res.status(200).json({ ok: true, draft: rec, html: null, errors: result.errors });
      }
      const generatedAt = rec.createdAt ? rec.createdAt.replace('T', ' ').slice(0, 16) + ' UTC' : '';
      return res.status(200).json({ ok: true, draft: rec, html: buildShell({ html: result.html, type: rec.type, generatedAt }) });
    }
    return res.status(200).json({ types: listDocumentTypes() });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rate = await consumeRateLimit('documents', ip, 30, 60000);
  if (rate.limited) {
    return res.status(429).json({ error: 'Too many document generations. Please wait a moment.' });
  }

  // Sprint document-intel-v1 (Pillar I4) — audit a customer's own document
  // (commercial invoice / packing list / certificate of origin) against their
  // plan. POST { action:'audit', documentType, fields, fromPlanId? | plan? }.
  if (req.body && req.body.action === 'audit') {
    const { documentType } = req.body;
    let fields = req.body.fields;
    let plan = (req.body.plan && typeof req.body.plan === 'object') ? req.body.plan : null;
    if (req.body.fromPlanId) {
      const user = auth.getCurrentUser(req);
      if (!user) return res.status(401).json({ error: 'Sign in to audit a document against a saved plan.' });
      const rec = await savedPlans.getPlan(String(req.body.fromPlanId), user.email);
      if (!rec || !rec.inputs) return res.status(404).json({ error: 'Plan not found' });
      plan = rec.inputs;
    }
    // Sprint document-intel-v2 — accept pasted raw text and extract the fields
    // deterministically before auditing. Explicit `fields` always win.
    let extraction = null;
    if ((!fields || typeof fields !== 'object') && typeof req.body.text === 'string' && req.body.text.trim()) {
      extraction = extractFields(req.body.text, documentType);
      fields = extraction.fields;
    }
    const result = auditDocument({ documentType, fields, plan });
    if (!result.ok) return res.status(400).json({ error: result.error });
    if (extraction) result.extraction = { extractedFields: extraction.extractedFields, missingFields: extraction.missingFields, confidence: extraction.confidence, note: extraction.note };
    return res.status(200).json(result);
  }

  // ── Approval workflow actions (Sprint document-approval-v1 / apex I5) ──
  //
  // `save` persists the post-merge draft in pending_approval; `approve` /
  // `reject` is the explicit human click that gates anything irreversible (the
  // platform itself never sends, files, or wire-transfers — these endpoints
  // just record the decision so an auditor can trace it).
  if (req.body && (req.body.action === 'approve' || req.body.action === 'reject')) {
    const user = auth.getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to approve a draft.' });
    const id = String(req.body.id || '');
    if (!id) return res.status(400).json({ error: '`id` is required' });
    const decision = req.body.action === 'approve' ? 'approved' : 'rejected';
    const out = await draftStore.decide(id, user.email, decision, req.body.notes);
    if (!out.ok) {
      const status = out.reason === 'not-found' ? 404 : (out.reason === 'already-decided' ? 409 : 400);
      return res.status(status).json({ error: out.reason, ...(out.currentStatus ? { currentStatus: out.currentStatus } : {}) });
    }
    if (!out.idempotent) {
      try {
        await events.record(decision === 'approved' ? 'document_approved' : 'document_rejected', {
          email: user.email, draftId: id, docType: out.record.type,
        });
      } catch (_) { /* audit best-effort */ }
    }
    return res.status(200).json({ ok: true, draft: out.record, idempotent: out.idempotent === true });
  }

  if (req.body && req.body.action === 'save') {
    const user = auth.getCurrentUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in to save a draft.' });
    const { type: t, data, fromPlan, fromPlanId, label } = req.body;
    if (!t) return res.status(400).json({ error: '`type` is required' });
    // Same pre-fill priority as the synchronous render path below.
    let docData = data;
    if (fromPlanId) {
      const rec = await savedPlans.getPlan(String(fromPlanId), user.email);
      if (!rec || !rec.inputs) return res.status(404).json({ error: 'Plan not found' });
      const draft = draftFromPlan(t, rec.inputs);
      if (!draft.ok) return res.status(400).json({ error: draft.error });
      docData = { ...draft.data, ...(data && typeof data === 'object' ? data : {}) };
    } else if (fromPlan && typeof fromPlan === 'object') {
      const draft = draftFromPlan(t, fromPlan);
      if (!draft.ok) return res.status(400).json({ error: draft.error });
      docData = { ...draft.data, ...(data && typeof data === 'object' ? data : {}) };
    }
    if (!docData || typeof docData !== 'object') {
      return res.status(400).json({ error: 'Provide `data`, `fromPlan`, or `fromPlanId` to pre-fill from a plan.' });
    }
    // Validate-and-render before persisting so we never store a draft that
    // won't render — the post-merge data is what we approve against.
    const result = generateDocument(t, docData);
    if (!result.ok) return res.status(400).json({ error: 'Validation failed', errors: result.errors });
    let record;
    try {
      record = await draftStore.createDraft({ email: user.email, type: t, data: docData, label });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'createDraft failed' });
    }
    try { await events.record('document_drafted', { email: user.email, draftId: record.id, docType: t }); } catch (_) {}
    const generatedAt = record.createdAt.replace('T', ' ').slice(0, 16) + ' UTC';
    return res.status(200).json({
      ok: true,
      draft: record,
      html: buildShell({ html: result.html, type: t, generatedAt }),
    });
  }

  const { type, data, fromPlan, fromPlanId } = req.body || {};
  if (!type) {
    return res.status(400).json({ error: '`type` is required' });
  }

  // Pre-fill priority: a saved plan id (authed, ownership-checked server-side)
  // > raw plan inputs > none. Any explicit `data` is merged over the draft so
  // the caller fills the placeholder parties / overrides fields in one call.
  let docData = data;
  if (fromPlanId) {
    // Sprint document-ui-v1 — draft straight from one of the signed-in user's
    // own saved plans. The id is resolved against their email so a caller can
    // never draft from someone else's plan.
    const user = auth.getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Sign in to draft a document from a saved plan.' });
    }
    const rec = await savedPlans.getPlan(String(fromPlanId), user.email);
    if (!rec || !rec.inputs) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    const draft = draftFromPlan(type, rec.inputs);
    if (!draft.ok) return res.status(400).json({ error: draft.error });
    docData = { ...draft.data, ...(data && typeof data === 'object' ? data : {}) };
  } else if (fromPlan && typeof fromPlan === 'object') {
    // Sprint document-prefill-v1 — pre-fill from raw plan inputs (no auth).
    const draft = draftFromPlan(type, fromPlan);
    if (!draft.ok) return res.status(400).json({ error: draft.error });
    docData = { ...draft.data, ...(data && typeof data === 'object' ? data : {}) };
  }
  if (!docData || typeof docData !== 'object') {
    return res.status(400).json({ error: 'Provide `data`, `fromPlan`, or `fromPlanId` to pre-fill from a plan.' });
  }

  const result = generateDocument(type, docData);
  if (!result.ok) {
    return res.status(400).json({ error: 'Validation failed', errors: result.errors });
  }

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const html = buildShell({ html: result.html, type, generatedAt });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
};
