CREATE TABLE IF NOT EXISTS hosted_agent_fast_v2_bindings (
  turn_id TEXT PRIMARY KEY REFERENCES hosted_agent_k0_turns(turn_id) ON DELETE CASCADE,
  browser_request_digest TEXT NOT NULL,
  editor_build_id TEXT NOT NULL,
  execution_contract_version TEXT NOT NULL,
  execution_contract_digest TEXT NOT NULL,
  snapshot_timeline_revision INTEGER NOT NULL
    CHECK (snapshot_timeline_revision >= 0),
  snapshot_state_fingerprint TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  capability_bundle_version TEXT NOT NULL,
  model_policy_version TEXT NOT NULL,
  budget_policy_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
