-- pgvector RAG corpus (Sprint rag-v1).
--
-- Stores embedded regulation chunks for semantic retrieval. Populated by the
-- `rag-reindex` cron (lib/intelligence/rag-index.js) from the same corpus the
-- BM25 index reads (lib/intelligence/corpus/*.json), so chunk_id stays the
-- citation key. Read by lib/intelligence/rag-store.js → searchHybrid().
--
-- Self-enabling: CREATE EXTENSION runs first. Neon supports pgvector on all
-- plans, so applying this migration is all that's needed to "enable pgvector".
-- The embedding dimension (1024) must match lib/ai/embeddings.js (voyage-3).
--
-- Until this is applied + a VOYAGE_API_KEY is set, retrieval stays pure BM25.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS corpus_chunks (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chunk_id    text NOT NULL UNIQUE,           -- matches the corpus JSON chunk id (citation key)
  regulation  text,                           -- regulation id, e.g. 'cbam' / 'eudr'
  title       text,
  content     text NOT NULL,                  -- the embedded text (title + summary)
  embedding   vector(1024),
  indexed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS corpus_chunks_embedding_idx
  ON corpus_chunks USING hnsw (embedding vector_cosine_ops);
