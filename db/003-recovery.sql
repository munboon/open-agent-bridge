ALTER TABLE bridge_agents ADD COLUMN IF NOT EXISTS takeover_digest text;
ALTER TABLE bridge_tasks ADD COLUMN IF NOT EXISTS cancellation_requested boolean NOT NULL DEFAULT false;
