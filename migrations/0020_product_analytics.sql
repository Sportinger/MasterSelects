CREATE TABLE IF NOT EXISTS product_analytics_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  session_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  app_version TEXT,
  properties_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_product_analytics_received
  ON product_analytics_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_analytics_event_received
  ON product_analytics_events(event_name, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_analytics_user_received
  ON product_analytics_events(user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_analytics_session_received
  ON product_analytics_events(session_id, received_at DESC);
