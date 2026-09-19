CREATE TABLE IF NOT EXISTS app_diagnostic_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('ai_generation', 'client_runtime')),
  stage TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'succeeded', 'failed', 'cancelled')),
  failure_code TEXT,
  provider_task_id TEXT,
  provider TEXT,
  model TEXT,
  output_type TEXT CHECK (output_type IS NULL OR output_type IN ('image', 'video', 'audio')),
  platform TEXT NOT NULL CHECK (platform IN ('windows', 'macos', 'linux', 'ios', 'android', 'other')),
  device_class TEXT NOT NULL CHECK (device_class IN ('desktop', 'tablet', 'mobile')),
  browser TEXT NOT NULL CHECK (browser IN ('chrome', 'edge', 'firefox', 'safari', 'other')),
  app_version TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_app_diagnostics_received
  ON app_diagnostic_events(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_diagnostics_kind_received
  ON app_diagnostic_events(kind, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_diagnostics_stage_outcome
  ON app_diagnostic_events(kind, stage, outcome, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_diagnostics_platform
  ON app_diagnostic_events(platform, device_class, received_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_diagnostics_ai_lifecycle
  ON app_diagnostic_events(user_id, provider_task_id, stage, outcome)
  WHERE kind = 'ai_generation';
