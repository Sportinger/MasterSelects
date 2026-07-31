CREATE TABLE IF NOT EXISTS hosted_agent_k0_turns (
  turn_id TEXT PRIMARY KEY,
  billing_turn_id TEXT NOT NULL UNIQUE REFERENCES ai_chat_turns(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT NOT NULL UNIQUE,
  client_instance_id TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_protocol TEXT NOT NULL
    CHECK (provider_protocol IN ('claude-messages', 'openai-responses')),
  protocol_version TEXT NOT NULL,
  requested_max_spend_credits INTEGER NOT NULL
    CHECK (requested_max_spend_credits > 0),
  accepted_max_spend_credits INTEGER NOT NULL
    CHECK (accepted_max_spend_credits > 0),
  maximum_iterations INTEGER NOT NULL
    CHECK (maximum_iterations > 0),
  prompt_version TEXT NOT NULL,
  history_format_version TEXT NOT NULL,
  tool_schema_version TEXT NOT NULL,
  assertion_nonce TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'provider_failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hosted_agent_k0_user_created
  ON hosted_agent_k0_turns(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hosted_agent_k0_user_status
  ON hosted_agent_k0_turns(user_id, status, updated_at DESC);
