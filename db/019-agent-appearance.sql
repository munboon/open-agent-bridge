ALTER TABLE bridge_agents ADD COLUMN appearance jsonb;
ALTER TABLE bridge_agents ADD CONSTRAINT agent_appearance_size CHECK (appearance IS NULL OR octet_length(appearance::text) <= 91000);
