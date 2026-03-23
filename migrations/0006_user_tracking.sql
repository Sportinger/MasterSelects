-- Track app version, AI model, and last login time per user
ALTER TABLE users ADD COLUMN last_app_version TEXT;
ALTER TABLE users ADD COLUMN last_ai_model TEXT;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
