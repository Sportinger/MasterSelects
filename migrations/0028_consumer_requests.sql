-- The consumer request log now covers both statutory flows: withdrawal
-- (Widerruf, §355 BGB) and ordinary cancellation through the cancellation
-- button (Kündigungsschaltfläche, §312k BGB). Requests are matched to the
-- signed-in or email-identified account so support can act on them.
ALTER TABLE withdrawal_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'withdrawal';
ALTER TABLE withdrawal_requests ADD COLUMN user_id TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN matched_subscription_id TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN requested_effective_at TEXT;
ALTER TABLE withdrawal_requests ADD COLUMN locale TEXT;

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_email
  ON withdrawal_requests(email, kind, received_at DESC);
