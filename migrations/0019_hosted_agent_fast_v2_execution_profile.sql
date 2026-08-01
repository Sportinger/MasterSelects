ALTER TABLE hosted_agent_fast_v2_bindings
ADD COLUMN execution_profile TEXT NOT NULL DEFAULT 'fast'
CHECK (execution_profile IN ('fast', 'verified'));
