CREATE TABLE IF NOT EXISTS ai_chat_turns (
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

CREATE INDEX IF NOT EXISTS idx_ai_chat_turns_user_created
  ON ai_chat_turns(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_chat_turns_status
  ON ai_chat_turns(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_chat_turn_rounds (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES ai_chat_turns(id),
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

CREATE INDEX IF NOT EXISTS idx_ai_chat_turn_rounds_turn
  ON ai_chat_turn_rounds(turn_id, round_index);
