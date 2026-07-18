ALTER TABLE credit_claims ADD COLUMN redeem_code_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_claims_redeem_code_hash
  ON credit_claims(redeem_code_hash)
  WHERE redeem_code_hash IS NOT NULL;
