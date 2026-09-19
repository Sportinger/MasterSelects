CREATE TABLE IF NOT EXISTS social_account_state (
  platform TEXT PRIMARY KEY,
  handle TEXT,
  external_account_id TEXT,
  account_state TEXT NOT NULL,
  follower_count INTEGER CHECK (follower_count IS NULL OR follower_count >= 0),
  follower_source TEXT NOT NULL DEFAULT 'unknown'
    CHECK (follower_source IN ('unknown', 'manual', 'api')),
  follower_updated_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS social_content_state (
  item_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  publish_at TEXT,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_social_content_state_status
  ON social_content_state(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS social_founder_input_state (
  input_key TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  request_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'skipped')),
  response_text TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_social_founder_input_state_status
  ON social_founder_input_state(status, item_id);

PRAGMA optimize;
