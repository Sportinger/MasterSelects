CREATE TABLE IF NOT EXISTS ai_audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT,
  idempotency_key TEXT,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL,
  prompt_json TEXT NOT NULL,
  moderation_status TEXT NOT NULL,
  moderation_flagged INTEGER NOT NULL DEFAULT 0,
  moderation_categories_json TEXT,
  provider_task_id TEXT,
  credit_cost INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_events_user_created
  ON ai_audit_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_events_request_id
  ON ai_audit_events(request_id);

CREATE INDEX IF NOT EXISTS idx_ai_audit_events_ip_hash
  ON ai_audit_events(ip_hash, created_at DESC);
