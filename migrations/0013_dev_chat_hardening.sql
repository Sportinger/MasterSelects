CREATE TRIGGER IF NOT EXISTS trg_users_delete_dev_chat_conversations
BEFORE DELETE ON users
FOR EACH ROW
BEGIN
  DELETE FROM dev_chat_conversations WHERE user_id = OLD.id;
END;

ALTER TABLE dev_chat_conversations ADD COLUMN expires_at TEXT;

UPDATE dev_chat_conversations
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+90 days')
WHERE expires_at IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_dev_chat_conversations_default_expiry
AFTER INSERT ON dev_chat_conversations
FOR EACH ROW
WHEN NEW.expires_at IS NULL
BEGIN
  UPDATE dev_chat_conversations
  SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.updated_at, '+90 days')
  WHERE id = NEW.id;
END;

CREATE INDEX IF NOT EXISTS idx_dev_chat_conversations_expiry
  ON dev_chat_conversations(expires_at)
  WHERE user_id IS NULL AND expires_at IS NOT NULL;

ALTER TABLE dev_chat_messages ADD COLUMN client_message_id TEXT;

ALTER TABLE dev_chat_messages ADD COLUMN telegram_correlation_id TEXT;

ALTER TABLE dev_chat_messages
  ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'delivered'
  CHECK (delivery_status IN ('pending', 'delivered'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_chat_messages_client_message
  ON dev_chat_messages(client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_chat_messages_telegram_correlation
  ON dev_chat_messages(telegram_correlation_id)
  WHERE telegram_correlation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS dev_chat_rate_limits (
  identity_hash TEXT NOT NULL,
  scope TEXT NOT NULL,
  window_minute INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (identity_hash, scope, window_minute)
);

CREATE INDEX IF NOT EXISTS idx_dev_chat_rate_limits_expiry
  ON dev_chat_rate_limits(expires_at);
