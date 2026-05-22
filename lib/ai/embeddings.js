'use strict';

// Voyage AI embeddings client (Sprint rag-v1).
//
// Raw fetch — consistent with the rest of OrcaTrade (no SDK, no new npm dep).
// Voyage is Anthropic's recommended embeddings provider; voyage-3 outputs
// 1024-dim vectors (must match the pgvector column in schema-003-rag.sql).
//
// Configured via VOYAGE_API_KEY (+ optional VOYAGE_MODEL). With no key,
// isConfigured() is false and embed() throws a clear error — every caller
// guards on isConfigured() first and degrades to BM25-only retrieval, so the
// platform works unchanged until the key is added.

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const DEFAULT_MODEL = process.env.VOYAGE_MODEL || 'voyage-3';
const EMBEDDING_DIM = 1024; // voyage-3 / voyage-3-large
const MAX_BATCH = 128;      // Voyage accepts up to 128 inputs per request
const TIMEOUT_MS = 20000;

function apiKey() {
  return process.env.VOYAGE_API_KEY || '';
}

function isConfigured() {
  return !!apiKey();
}

async function embedBatch(texts, inputType) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(VOYAGE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey(),
      },
      body: JSON.stringify({ input: texts, model: DEFAULT_MODEL, input_type: inputType }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    // Response: { data: [{ embedding: [...], index }], ... } — order by index.
    return (data.data || [])
      .slice()
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map(d => d.embedding);
  } finally {
    clearTimeout(timer);
  }
}

// Embed one or many texts → array of vectors (same order). inputType is
// 'document' for indexing, 'query' for a search query (Voyage tunes each).
async function embed(texts, { inputType = 'document' } = {}) {
  if (!isConfigured()) throw new Error('embeddings: VOYAGE_API_KEY not set');
  const list = Array.isArray(texts) ? texts : [texts];
  if (!list.length) return [];
  const out = [];
  for (let i = 0; i < list.length; i += MAX_BATCH) {
    const vecs = await embedBatch(list.slice(i, i + MAX_BATCH), inputType);
    out.push(...vecs);
  }
  return out;
}

async function embedQuery(text) {
  const [vec] = await embed([text], { inputType: 'query' });
  return vec || null;
}

module.exports = {
  isConfigured,
  embed,
  embedQuery,
  DEFAULT_MODEL,
  EMBEDDING_DIM,
  MAX_BATCH,
};
