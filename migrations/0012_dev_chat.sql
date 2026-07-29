CREATE TABLE IF NOT EXISTS dev_chat_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dev_chat_conversations_user
  ON dev_chat_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS dev_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES dev_chat_conversations(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'developer')),
  message TEXT NOT NULL,
  telegram_chat_id TEXT,
  telegram_message_id INTEGER,
  telegram_update_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dev_chat_messages_conversation
  ON dev_chat_messages(conversation_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_chat_messages_telegram_message
  ON dev_chat_messages(telegram_chat_id, telegram_message_id)
  WHERE telegram_chat_id IS NOT NULL AND telegram_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_chat_messages_telegram_update
  ON dev_chat_messages(telegram_update_id)
  WHERE telegram_update_id IS NOT NULL;
