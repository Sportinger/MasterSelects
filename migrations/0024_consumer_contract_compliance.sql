CREATE TABLE IF NOT EXISTS billing_legal_consents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  plan_id TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  withdrawal_version TEXT NOT NULL,
  terms_accepted INTEGER NOT NULL CHECK (terms_accepted = 1),
  withdrawal_policy_read INTEGER NOT NULL CHECK (withdrawal_policy_read = 1),
  immediate_performance_requested INTEGER NOT NULL CHECK (immediate_performance_requested = 1),
  accepted_at TEXT NOT NULL,
  stripe_session_id TEXT,
  confirmation_email_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_billing_legal_consents_user
  ON billing_legal_consents(user_id, accepted_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_legal_consents_stripe_session
  ON billing_legal_consents(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  contract_reference TEXT NOT NULL,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  confirmation_email_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_received
  ON withdrawal_requests(received_at DESC);
