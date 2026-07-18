ALTER TABLE credit_claims ADD COLUMN campaign TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_claims_campaign_active
  ON credit_claims(campaign, expires_at)
  WHERE campaign IS NOT NULL;

CREATE TABLE IF NOT EXISTS credit_claim_campaigns (
  id TEXT PRIMARY KEY,
  is_armed INTEGER NOT NULL DEFAULT 1 CHECK (is_armed IN (0, 1)),
  claimed_claim_id TEXT REFERENCES credit_claims(id),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
