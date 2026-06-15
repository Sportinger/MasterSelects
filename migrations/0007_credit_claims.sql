CREATE TABLE IF NOT EXISTS credit_claims (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'Credit reward',
  description TEXT,
  expected_email TEXT,
  expires_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'cloudflare-admin',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  claimed_by_user_id TEXT REFERENCES users(id),
  claimed_email TEXT,
  claimed_at TEXT,
  revoked_at TEXT,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_credit_claims_token_hash
  ON credit_claims(token_hash);

CREATE INDEX IF NOT EXISTS idx_credit_claims_claimed_user
  ON credit_claims(claimed_by_user_id);

CREATE INDEX IF NOT EXISTS idx_credit_claims_expires
  ON credit_claims(expires_at);
