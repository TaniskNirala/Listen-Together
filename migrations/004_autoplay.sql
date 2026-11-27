-- Persist customizable room Autoplay settings, blocked artists, and disliked tracks (safe & idempotent)
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS autoplay_json JSONB NULL;
