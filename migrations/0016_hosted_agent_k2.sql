ALTER TABLE hosted_agent_k0_turns
  ADD COLUMN tool_execution_mode TEXT NOT NULL DEFAULT 'read-only'
  CHECK (tool_execution_mode IN ('normal', 'plan', 'read-only'));
