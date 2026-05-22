'use strict';

// Build + (re)index the regulation corpus into the pgvector store (Sprint
// rag-v1). The embedded text is each chunk's title + summary; chunk_id is
// preserved as the citation key. Driven by the `rag-reindex` cron.

const retrieval = require('./retrieval');

// Flatten the loaded corpora into embeddable chunks. Pure — no embeddings, no
// DB — so it's unit-testable against the real corpus.
function buildChunksFromCorpus() {
  const corpora = retrieval.loadCorpora();
  const out = [];
  for (const corpus of Object.values(corpora)) {
    const regulation = corpus.regulation && corpus.regulation.id;
    for (const chunk of corpus.chunks || []) {
      const content = [chunk.title, chunk.summary].filter(Boolean).join('. ').trim();
      if (!chunk.id || !content) continue;
      out.push({ chunkId: chunk.id, regulation: regulation || null, title: chunk.title || null, content });
    }
  }
  return out;
}

// Embed every chunk and upsert it. Guarded: needs both a Voyage key and a DB.
// dryRun builds the chunk set without embedding or writing (cost-free check).
async function reindex({ dryRun = false } = {}) {
  const chunks = buildChunksFromCorpus();
  if (dryRun) return { ok: true, dryRun: true, chunks: chunks.length };

  const embeddings = require('../ai/embeddings');
  const store = require('./rag-store');
  if (!embeddings.isConfigured()) return { ok: false, reason: 'VOYAGE_API_KEY not set', chunks: chunks.length };
  if (!store.isAvailable()) return { ok: false, reason: 'DATABASE_URL not set', chunks: chunks.length };

  const vectors = await embeddings.embed(chunks.map(c => c.content), { inputType: 'document' });
  let indexed = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    if (!vectors[i]) continue;
    await store.upsertChunk({ ...chunks[i], embedding: vectors[i] });
    indexed += 1;
  }
  return { ok: true, indexed, chunks: chunks.length };
}

module.exports = {
  buildChunksFromCorpus,
  reindex,
};
