CREATE TABLE IF NOT EXISTS guest_welcome_credit_claims (
  client_fingerprint_hash TEXT PRIMARY KEY,
  network_hash TEXT NOT NULL,
  user_id TEXT NOT NULL UNIQUE REFERENCES guest_accounts(user_id) ON DELETE CASCADE,
  claimed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_guest_welcome_credit_claims_network
  ON guest_welcome_credit_claims(network_hash, claimed_at);
