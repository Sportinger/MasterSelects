ALTER TABLE app_diagnostic_events ADD COLUMN component TEXT;

CREATE INDEX IF NOT EXISTS idx_app_diagnostics_component
  ON app_diagnostic_events(kind, component, received_at DESC);
