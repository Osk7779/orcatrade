const test = require('node:test');
const assert = require('node:assert/strict');

const embeddings = require('../lib/ai/embeddings');
const ragStore = require('../lib/intelligence/rag-store');
const ragIndex = require('../lib/intelligence/rag-index');
const retrieval = require('../lib/intelligence/retrieval');
const cron = require('../lib/handlers/cron');

// Tests run with no VOYAGE_API_KEY and no DATABASE_URL, so everything must
// degrade to the documented fallbacks (BM25-only) and never throw.

// ── embeddings client ───────────────────────────────────

test('embeddings: not configured without VOYAGE_API_KEY', () => {
  const had = process.env.VOYAGE_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  assert.equal(embeddings.isConfigured(), false);
  assert.equal(embeddings.EMBEDDING_DIM, 1024);
  if (had) process.env.VOYAGE_API_KEY = had;
});

test('embeddings: embed() throws a clear error when not configured', async () => {
  const had = process.env.VOYAGE_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  await assert.rejects(() => embeddings.embed(['x']), /VOYAGE_API_KEY/);
  if (had) process.env.VOYAGE_API_KEY = had;
});

// ── vector store ────────────────────────────────────────

test('rag-store: unavailable without DB; search → [], count → 0', async () => {
  assert.equal(ragStore.isAvailable(), false);
  assert.deepEqual(await ragStore.searchByVector([0.1, 0.2, 0.3], 5), []);
  assert.equal(await ragStore.count(), 0);
});

test('rag-store: upsert without a DB reports the reason (no throw)', async () => {
  const r = await ragStore.upsertChunk({ chunkId: 'x', content: 'y', embedding: [0.1] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /DATABASE_URL/);
});

test('rag-store: toVectorLiteral formats a pgvector literal', () => {
  assert.equal(ragStore.toVectorLiteral([0.1, 0.2, 0.3]), '[0.1,0.2,0.3]');
  assert.equal(ragStore.toVectorLiteral([]), '[]');
});

// ── corpus → chunks ─────────────────────────────────────

test('rag-index: buildChunksFromCorpus yields chunk_id + content from the real corpus', () => {
  const chunks = ragIndex.buildChunksFromCorpus();
  assert.ok(chunks.length >= 1, 'corpus produced chunks');
  for (const c of chunks) {
    assert.ok(c.chunkId);
    assert.ok(c.content && c.content.length > 0);
  }
  // The bundled corpus includes CBAM + EUDR.
  assert.ok(chunks.some(c => c.regulation === 'eudr' || c.regulation === 'cbam'));
});

test('rag-index: reindex(dryRun) counts chunks without embedding or writing', async () => {
  const r = await ragIndex.reindex({ dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.ok(r.chunks >= 1);
});

test('rag-index: reindex (non-dry) without a Voyage key reports the reason', async () => {
  const had = process.env.VOYAGE_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  const r = await ragIndex.reindex({ dryRun: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /VOYAGE_API_KEY/);
  if (had) process.env.VOYAGE_API_KEY = had;
});

// ── hybrid retrieval falls back to BM25 ─────────────────

test('searchHybrid falls back to BM25 when RAG is unavailable', async () => {
  retrieval.resetCache();
  const bm25 = retrieval.search('deforestation due diligence', { topK: 5 });
  const hybrid = await retrieval.searchHybrid('deforestation due diligence', { topK: 5 });
  assert.ok(Array.isArray(hybrid));
  // With no embeddings/DB, hybrid === BM25 (same top chunk + shape).
  assert.ok(hybrid.length >= 1);
  assert.ok(hybrid[0].chunk && hybrid[0].chunk.id);
  assert.equal(hybrid[0].chunk.id, bm25[0].chunk.id);
});

test('searchHybrid returns [] for an empty/no-signal query (BM25 behaviour)', async () => {
  assert.deepEqual(await retrieval.searchHybrid('   ', { topK: 5 }), []);
});

// ── cron wiring ─────────────────────────────────────────

test('cron: rag-reindex is registered + dryRun works', async () => {
  assert.equal(typeof cron.JOBS['rag-reindex'], 'function');
  const r = await cron.runRagReindex({ dryRun: true });
  assert.equal(r.ok, true);
  assert.ok(r.chunks >= 1);
});
