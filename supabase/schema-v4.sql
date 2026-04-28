-- ─── supabase/schema-v4.sql ──────────────────────────────────────────────────
-- V4 ADDITIONS — run after schema.sql
-- Adds: evaluation results, self-improvement records, prompt versions

-- ── Evaluation results ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS evaluation_results (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id               text NOT NULL,
  user_id              text,
  query                text NOT NULL,
  domain               text NOT NULL DEFAULT 'general',
  factual_accuracy     float NOT NULL DEFAULT 0.5,
  completeness         float NOT NULL DEFAULT 0.5,
  coherence            float NOT NULL DEFAULT 0.5,
  citation_quality     float NOT NULL DEFAULT 0.3,
  overall_score        float NOT NULL DEFAULT 0.5,
  calibration_error    float NOT NULL DEFAULT 0,
  regression_baseline  float NOT NULL DEFAULT 0,
  issues               jsonb NOT NULL DEFAULT '[]',
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eval_results_run_id_idx ON evaluation_results (run_id);
CREATE INDEX IF NOT EXISTS eval_results_domain_idx  ON evaluation_results (domain);

-- ── Self-improvement records ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS improvement_records (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pattern        text NOT NULL,
  failure_mode   text NOT NULL,
  correction     text NOT NULL,
  domain         text NOT NULL DEFAULT 'general',
  applied_count  integer NOT NULL DEFAULT 0,
  success_rate   float NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS improvements_domain_idx ON improvement_records (domain);

-- ── Prompt versions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompt_versions (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  role           text NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  content        text NOT NULL,
  domain         text,
  success_rate   float NOT NULL DEFAULT 0,
  avg_confidence float NOT NULL DEFAULT 0,
  use_count      integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prompt_versions_role_idx   ON prompt_versions (role);
CREATE INDEX IF NOT EXISTS prompt_versions_active_idx ON prompt_versions (is_active);

-- ── Circuit breaker state (optional persistence) ───────────────────────────────
CREATE TABLE IF NOT EXISTS circuit_breaker_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider     text NOT NULL,
  event        text NOT NULL,  -- 'open' | 'close' | 'failure' | 'success'
  failure_count integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Add evaluation_id FK to memory_contexts ───────────────────────────────────
ALTER TABLE memory_contexts ADD COLUMN IF NOT EXISTS evaluation_id uuid REFERENCES evaluation_results(id);
ALTER TABLE memory_contexts ADD COLUMN IF NOT EXISTS domain text DEFAULT 'general';
ALTER TABLE memory_contexts ADD COLUMN IF NOT EXISTS circuit_breaks integer DEFAULT 0;
ALTER TABLE memory_contexts ADD COLUMN IF NOT EXISTS agent_messages_count integer DEFAULT 0;
