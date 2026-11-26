-- Add persisted reply references to room chat messages (safe & idempotent on Neon Postgres and PGlite)
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS reply_to_username TEXT NULL,
  ADD COLUMN IF NOT EXISTS reply_to_body TEXT NULL;
