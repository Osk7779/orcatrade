// Document approval workflow (Sprint document-approval-v1, apex Pillar I5).

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ORCATRADE_AUTH_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const kv = require('../lib/intelligence/kv-store');
const auth = require('../lib/auth');
const savedPlans = require('../lib/saved-plans');
const documents = require('../lib/handlers/documents');
const draftStore = require('../lib/draft-store');
const events = require('../lib/events');

function mockRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    send(b) { this.body = b; return this; },
    end() { return this; },
  };
}
function authedReq(method, body, query) {
  const cookie = auth.buildSessionCookie('me@acme.test');
  return { method, body, query: query || {}, headers: { cookie: 'orcatrade_session=' + encodeURIComponent(cookie) } };
}
async function call(req) { const res = mockRes(); await documents(req, res); return res; }

const PLAN_INPUTS = { productCategory: 'apparel', originCountry: 'CN', destinationCountry: 'DE', customsValueEur: 50000, hsCode: '610910', moq: 1000 };

// ── store-level invariants ──────────────────────────────

test('createDraft: lands in pending_approval with a dr_ id', async () => {
  kv._resetMemoryStore();
  const rec = await draftStore.createDraft({ email: 'me@acme.test', type: 'commercial_invoice', data: { lineItems: [] }, label: 'Test' });
  assert.match(rec.id, /^dr_[0-9a-f]{16}$/);
  assert.equal(rec.status, 'pending_approval');
  assert.equal(rec.email, 'me@acme.test');
});

test('decide: pending → approved is one-way; re-decide is rejected', async () => {
  kv._resetMemoryStore();
  const rec = await draftStore.createDraft({ email: 'me@acme.test', type: 'commercial_invoice', data: {} });
  const ok = await draftStore.decide(rec.id, 'me@acme.test', 'approved');
  assert.equal(ok.ok, true);
  assert.equal(ok.record.status, 'approved');
  // re-approving same decision is idempotent
  const again = await draftStore.decide(rec.id, 'me@acme.test', 'approved');
  assert.equal(again.idempotent, true);
  // attempting to flip approved → rejected is refused
  const flip = await draftStore.decide(rec.id, 'me@acme.test', 'rejected');
  assert.equal(flip.ok, false);
  assert.equal(flip.reason, 'already-decided');
});

test('ownership: another user cannot read or decide on my draft', async () => {
  kv._resetMemoryStore();
  const rec = await draftStore.createDraft({ email: 'me@acme.test', type: 'commercial_invoice', data: {} });
  assert.equal(await draftStore.getDraft(rec.id, 'someone@else.test'), null);
  const out = await draftStore.decide(rec.id, 'someone@else.test', 'approved');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'not-found');
});

// ── handler end-to-end ──────────────────────────────────

test('POST action=save persists a draft and returns html + record', async () => {
  kv._resetMemoryStore();
  const saved = await savedPlans.savePlan({ email: 'me@acme.test', inputs: PLAN_INPUTS, label: 'Apparel' });
  const planId = (saved.plan && saved.plan.id) || saved.id;
  const res = await call(authedReq('POST', { action: 'save', type: 'commercial_invoice', fromPlanId: planId, label: 'CI for Apparel' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.draft.status, 'pending_approval');
  assert.match(res.body.draft.id, /^dr_[0-9a-f]{16}$/);
  assert.match(String(res.body.html), /Commercial Invoice/);
});

test('POST action=save without a session → 401', async () => {
  kv._resetMemoryStore();
  const res = await call({ method: 'POST', headers: {}, body: { action: 'save', type: 'commercial_invoice', fromPlan: PLAN_INPUTS } });
  assert.equal(res.statusCode, 401);
});

test('GET action=list-mine + GET action=get round-trip the draft', async () => {
  kv._resetMemoryStore();
  const saved = await savedPlans.savePlan({ email: 'me@acme.test', inputs: PLAN_INPUTS });
  const planId = (saved.plan && saved.plan.id) || saved.id;
  // save one
  const saveRes = await call(authedReq('POST', { action: 'save', type: 'commercial_invoice', fromPlanId: planId }));
  const draftId = saveRes.body.draft.id;
  // list-mine
  const listRes = await call(authedReq('GET', null, { action: 'list-mine' }));
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.body.drafts.length, 1);
  assert.equal(listRes.body.drafts[0].id, draftId);
  assert.equal(listRes.body.drafts[0].status, 'pending_approval');
  // get one
  const getRes = await call(authedReq('GET', null, { action: 'get', id: draftId }));
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.body.draft.id, draftId);
  assert.match(String(getRes.body.html), /Commercial Invoice/);
});

test('POST action=approve → status approved + audit-logged', async () => {
  kv._resetMemoryStore();
  const saved = await savedPlans.savePlan({ email: 'me@acme.test', inputs: PLAN_INPUTS });
  const planId = (saved.plan && saved.plan.id) || saved.id;
  const saveRes = await call(authedReq('POST', { action: 'save', type: 'commercial_invoice', fromPlanId: planId }));
  const draftId = saveRes.body.draft.id;
  const approveRes = await call(authedReq('POST', { action: 'approve', id: draftId, notes: 'looks good' }));
  assert.equal(approveRes.statusCode, 200);
  assert.equal(approveRes.body.draft.status, 'approved');
  assert.equal(approveRes.body.draft.decisionNotes, 'looks good');
  // audit row exists
  const list = await events.list({ limit: 100 });
  const drafted = list.filter((e) => e.type === 'document_drafted').length;
  const approved = list.filter((e) => e.type === 'document_approved').length;
  assert.ok(drafted >= 1, 'a document_drafted event was recorded');
  assert.ok(approved >= 1, 'a document_approved event was recorded');
});

test('POST action=reject sets rejected; a second decision is a 409', async () => {
  kv._resetMemoryStore();
  const saved = await savedPlans.savePlan({ email: 'me@acme.test', inputs: PLAN_INPUTS });
  const planId = (saved.plan && saved.plan.id) || saved.id;
  const saveRes = await call(authedReq('POST', { action: 'save', type: 'commercial_invoice', fromPlanId: planId }));
  const draftId = saveRes.body.draft.id;
  const rejectRes = await call(authedReq('POST', { action: 'reject', id: draftId, notes: 'wrong currency' }));
  assert.equal(rejectRes.statusCode, 200);
  assert.equal(rejectRes.body.draft.status, 'rejected');
  // can't flip rejected → approved
  const flipRes = await call(authedReq('POST', { action: 'approve', id: draftId }));
  assert.equal(flipRes.statusCode, 409);
});
