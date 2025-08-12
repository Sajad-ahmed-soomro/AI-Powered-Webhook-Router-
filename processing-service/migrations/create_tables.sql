-- create extension for gen_random_uuid if you plan to use UUIDs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure ingestion schema & logs (if not already)
CREATE SCHEMA IF NOT EXISTS ingestion;

CREATE TABLE IF NOT EXISTS ingestion.logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT,
  headers JSONB,
  payload JSONB,
  received_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending'
);

-- For processing results
CREATE TABLE IF NOT EXISTS processed_results (
  id SERIAL PRIMARY KEY,
  log_id UUID,
  result JSONB,
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- Retry queue table
CREATE TABLE IF NOT EXISTS retry_queue (
  id SERIAL PRIMARY KEY,
  log_id UUID,
  error_message TEXT,
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ingestion_received_at ON ingestion.logs (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_status ON ingestion.logs (status);
