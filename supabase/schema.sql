-- ─── supabase/schema.sql ──────────────────────────────────────────────────────
-- Run this in your Supabase SQL editor to set up all tables.
-- Requires the pgvector extension (available on all Supabase plans).

-- ── Enable extensions ─────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Document chunks (RAG) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      text NOT NULL,
  doc_id       text NOT NULL,
  content      text NOT NULL,
  embedding    vector(1536),
  chunk_index  integer NOT NULL DEFAULT 0,
  token_count  integer NOT NULL DEFAULT 0,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_chunks_user_id_idx ON document_chunks (user_id);
CREATE INDEX IF NOT EXISTS document_chunks_doc_id_idx  ON document_chunks (doc_id);

-- ANN index for fast similarity search (tune lists = sqrt(row_count))
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ── Memory contexts ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_contexts (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          text NOT NULL,
  run_id           text,
  query            text NOT NULL,
  answer           text NOT NULL,
  summary          text,
  provider         text NOT NULL,
  model            text NOT NULL,
  confidence       float NOT NULL DEFAULT 0.5,
  key_findings     jsonb DEFAULT '[]',
  depth            text DEFAULT 'standard',
  total_tokens     integer DEFAULT 0,
  total_latency_ms integer DEFAULT 0,
  embedding        vector(1536),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_contexts_user_id_idx   ON memory_contexts (user_id);
CREATE INDEX IF NOT EXISTS memory_contexts_created_at_idx ON memory_contexts (created_at DESC);

CREATE INDEX IF NOT EXISTS memory_contexts_embedding_idx
  ON memory_contexts
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- ── Match documents function ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.65,
  match_count     int   DEFAULT 20,
  p_user_id       text  DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  content     text,
  metadata    jsonb,
  similarity  float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    content,
    metadata,
    1 - (embedding <=> query_embedding) AS similarity
  FROM document_chunks
  WHERE
    (p_user_id IS NULL OR user_id = p_user_id)
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── Match memories function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.75,
  match_count     int   DEFAULT 5,
  p_user_id       text  DEFAULT NULL
)
RETURNS TABLE (
  id         uuid,
  query      text,
  summary    text,
  confidence float,
  created_at timestamptz,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    id,
    query,
    summary,
    confidence,
    created_at,
    1 - (embedding <=> query_embedding) AS similarity
  FROM memory_contexts
  WHERE
    (p_user_id IS NULL OR user_id = p_user_id)
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) > match_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── Row Level Security (optional, enable for multi-tenant) ────────────────────
-- ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE memory_contexts ENABLE ROW LEVEL SECURITY;
