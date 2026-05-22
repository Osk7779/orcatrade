'use strict';

// Postgres + pgvector store for embedded regulation chunks (Sprint rag-v1).
// Written by the rag-reindex cron, read by retrieval.searchHybrid().
//
// Degrades safely: no DATABASE_URL → isAvailable() false, search returns [],
// upsert reports a reason. A read error never throws (retrieval falls back to
// BM25). pgvector params are passed as a '[v1,v2,…]' literal cast to ::vector.

const db = require('../db/client');
const log = require('../log').withContext({ module: 'rag-store' });

function isAvailable() {
  return db.isConfigured();
}

function toVectorLiteral(vec) {
  return '[' + (Array.isArray(vec) ? vec : []).map(x => Number(x)).join(',') + ']';
}

async function upsertChunk({ chunkId, regulation, title, content, embedding }) {
  if (!isAvailable()) return { ok: false, reason: 'DATABASE_URL not set' };
  await db.query(
    `INSERT INTO corpus_chunks (chunk_id, regulation, title, content, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
     ON CONFLICT (chunk_id) DO UPDATE SET
       regulation = EXCLUDED.regulation,
       title      = EXCLUDED.title,
       content    = EXCLUDED.content,
       embedding  = EXCLUDED.embedding,
       indexed_at = now()`,
    [chunkId, regulation || null, title || null, String(content || ''), toVectorLiteral(embedding)],
  );
  return { ok: true };
}

// Nearest chunks to a query vector by cosine distance. Returns
// [{ chunkId, regulation, similarity }] (caller resolves chunk_id → chunk via
// retrieval.getChunkById to keep citations sourced from the corpus). Never throws.
async function searchByVector(queryVec, topK = 8) {
  if (!isAvailable() || !Array.isArray(queryVec) || !queryVec.length) return [];
  try {
    const rows = await db.query(
      `SELECT chunk_id, regulation, 1 - (embedding <=> $1::vector) AS similarity
         FROM corpus_chunks
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [toVectorLiteral(queryVec), topK],
    );
    return (rows || []).map(r => ({
      chunkId: r.chunk_id,
      regulation: r.regulation || null,
      similarity: Number(r.similarity),
    }));
  } catch (err) {
    log.error('searchByVector failed; retrieval will fall back to BM25', { err: err.message });
    return [];
  }
}

async function count() {
  if (!isAvailable()) return 0;
  try {
    const rows = await db.query('SELECT count(*)::int AS n FROM corpus_chunks WHERE embedding IS NOT NULL');
    return (rows && rows[0] && rows[0].n) || 0;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  isAvailable,
  toVectorLiteral,
  upsertChunk,
  searchByVector,
  count,
};
