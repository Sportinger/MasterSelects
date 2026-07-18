ALTER TABLE credit_claim_campaigns ADD COLUMN active_claim_id TEXT REFERENCES credit_claims(id);
