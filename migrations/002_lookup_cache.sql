-- Migration 002: Music metadata & search lookup cache with TTL

CREATE TABLE IF NOT EXISTS lookup_cache (
  cache_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lookup_cache_expires ON lookup_cache (expires_at);
