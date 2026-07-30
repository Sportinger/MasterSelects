ALTER TABLE credit_claims ADD COLUMN token_ciphertext TEXT;
ALTER TABLE credit_claims ADD COLUMN token_iv TEXT;

CREATE INDEX IF NOT EXISTS idx_credit_claims_admin_status
  ON credit_claims(claimed_at, revoked_at, expires_at, created_at);
