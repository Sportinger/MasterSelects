CREATE TABLE ai_chat_turns_terminal_statuses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  model TEXT NOT NULL,
  protocol TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled', 'provider_failed')),
  provider_credits REAL NOT NULL DEFAULT 0,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  max_spend_credits INTEGER NOT NULL,
  next_round_index INTEGER NOT NULL DEFAULT 0,
  terminal_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE TABLE ai_chat_turn_rounds_terminal_statuses (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES ai_chat_turns_terminal_statuses(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  round_index INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'settled', 'cancelled', 'provider_failed')),
  provider_credits REAL,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  total_provider_credits REAL,
  total_credits_charged INTEGER,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  has_more_tools INTEGER NOT NULL DEFAULT 0,
  response_json TEXT,
  ledger_entry_id TEXT REFERENCES credit_ledger(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  settled_at TEXT,
  UNIQUE(turn_id, round_index)
);

CREATE TABLE hosted_agent_k0_turns_terminal_statuses (
  turn_id TEXT PRIMARY KEY,
  billing_turn_id TEXT NOT NULL UNIQUE REFERENCES ai_chat_turns_terminal_statuses(id),
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
  completed_at TEXT,
  tool_execution_mode TEXT NOT NULL DEFAULT 'read-only'
    CHECK (tool_execution_mode IN ('normal', 'plan', 'read-only'))
);

INSERT INTO ai_chat_turns_terminal_statuses (
  id,
  user_id,
  model,
  protocol,
  status,
  provider_credits,
  credits_charged,
  max_spend_credits,
  next_round_index,
  terminal_reason,
  created_at,
  updated_at,
  completed_at
)
SELECT
  id,
  user_id,
  model,
  protocol,
  CASE status WHEN 'failed' THEN 'provider_failed' ELSE status END,
  provider_credits,
  credits_charged,
  max_spend_credits,
  next_round_index,
  terminal_reason,
  created_at,
  updated_at,
  completed_at
FROM ai_chat_turns;

INSERT INTO ai_chat_turn_rounds_terminal_statuses (
  id,
  turn_id,
  user_id,
  round_index,
  idempotency_key,
  status,
  provider_credits,
  credits_charged,
  total_provider_credits,
  total_credits_charged,
  input_tokens,
  cached_input_tokens,
  output_tokens,
  reasoning_tokens,
  tool_call_count,
  has_more_tools,
  response_json,
  ledger_entry_id,
  created_at,
  settled_at
)
SELECT
  id,
  turn_id,
  user_id,
  round_index,
  idempotency_key,
  status,
  provider_credits,
  credits_charged,
  total_provider_credits,
  total_credits_charged,
  input_tokens,
  cached_input_tokens,
  output_tokens,
  reasoning_tokens,
  tool_call_count,
  has_more_tools,
  response_json,
  ledger_entry_id,
  created_at,
  settled_at
FROM ai_chat_turn_rounds;

INSERT INTO hosted_agent_k0_turns_terminal_statuses (
  turn_id,
  billing_turn_id,
  user_id,
  session_id,
  client_instance_id,
  model,
  provider_protocol,
  protocol_version,
  requested_max_spend_credits,
  accepted_max_spend_credits,
  maximum_iterations,
  prompt_version,
  history_format_version,
  tool_schema_version,
  assertion_nonce,
  status,
  created_at,
  updated_at,
  completed_at,
  tool_execution_mode
)
SELECT
  turn_id,
  billing_turn_id,
  user_id,
  session_id,
  client_instance_id,
  model,
  provider_protocol,
  protocol_version,
  requested_max_spend_credits,
  accepted_max_spend_credits,
  maximum_iterations,
  prompt_version,
  history_format_version,
  tool_schema_version,
  assertion_nonce,
  status,
  created_at,
  updated_at,
  completed_at,
  tool_execution_mode
FROM hosted_agent_k0_turns;

DROP TABLE ai_chat_turn_rounds;
DROP TABLE hosted_agent_k0_turns;
DROP TABLE ai_chat_turns;
ALTER TABLE ai_chat_turns_terminal_statuses RENAME TO ai_chat_turns;
ALTER TABLE ai_chat_turn_rounds_terminal_statuses RENAME TO ai_chat_turn_rounds;
ALTER TABLE hosted_agent_k0_turns_terminal_statuses RENAME TO hosted_agent_k0_turns;

CREATE INDEX idx_ai_chat_turns_user_created
  ON ai_chat_turns(user_id, created_at DESC);

CREATE INDEX idx_ai_chat_turns_status
  ON ai_chat_turns(user_id, status, updated_at DESC);

CREATE INDEX idx_ai_chat_turn_rounds_turn
  ON ai_chat_turn_rounds(turn_id, round_index);

CREATE INDEX idx_hosted_agent_k0_user_created
  ON hosted_agent_k0_turns(user_id, created_at DESC);

CREATE INDEX idx_hosted_agent_k0_user_status
  ON hosted_agent_k0_turns(user_id, status, updated_at DESC);
