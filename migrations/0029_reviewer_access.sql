-- Explicitly provisioned accounts only. No automatic credits or periodic reset.
CREATE TABLE reviewer_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  credential_hash TEXT NOT NULL CHECK(length(credential_hash) = 64),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
  budget_eur_micros INTEGER NOT NULL DEFAULT 5000000
    CHECK(budget_eur_micros BETWEEN 0 AND 5000000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE reviewer_cost_reservations (
  user_id TEXT NOT NULL REFERENCES reviewer_accounts(user_id),
  request_id TEXT NOT NULL,
  operation_digest TEXT NOT NULL,
  upper_bound_eur_micros INTEGER NOT NULL CHECK(upper_bound_eur_micros > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY(user_id, request_id)
);

-- Admission and insertion are one SQLite write, including concurrent callers.
CREATE TRIGGER reviewer_reservation_budget BEFORE INSERT ON reviewer_cost_reservations
WHEN NOT EXISTS (
  SELECT 1 FROM reviewer_accounts r WHERE r.user_id = NEW.user_id AND r.enabled = 1
    AND NEW.upper_bound_eur_micros <= r.budget_eur_micros - (
      SELECT COALESCE(SUM(upper_bound_eur_micros), 0)
      FROM reviewer_cost_reservations WHERE user_id = NEW.user_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'reviewer_budget_exceeded');
END;
