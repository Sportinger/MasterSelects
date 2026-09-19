-- Runtime diagnostics carry the actual failure content from now on: message,
-- error name, stack, a cross-build fingerprint for grouping, repeat counts,
-- page, session/device identity, request metadata, and a JSON context blob
-- (device capabilities, memory, network, WebGPU adapter, breadcrumbs).
ALTER TABLE app_diagnostic_events ADD COLUMN message TEXT;
ALTER TABLE app_diagnostic_events ADD COLUMN error_name TEXT;
ALTER TABLE app_diagnostic_events ADD COLUMN stack TEXT;
ALTER TABLE app_diagnostic_events ADD COLUMN fingerprint TEXT;
ALTER TABLE app_diagnostic_events ADD COLUMN repeat_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_diagnostic_events ADD COLUMN page_path TEXT;
ALTER TABLE app_diagnostic_events ADD COLUMN session_id TEXT;
ALTER TABLE app_diagnostic_events ADD COLUMN device_id TEXT;
ALTER TABLE app_diagnostic_events ADD COLUMN user_agent TEXT;
ALTER TABLE app_diagnostic_events ADD COLUMN country TEXT;
ALTER TABLE app_diagnostic_events ADD COLUMN context_json TEXT;

CREATE INDEX IF NOT EXISTS idx_app_diagnostics_fingerprint
  ON app_diagnostic_events(kind, fingerprint, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_diagnostics_session
  ON app_diagnostic_events(session_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_diagnostics_device
  ON app_diagnostic_events(device_id, received_at DESC);
