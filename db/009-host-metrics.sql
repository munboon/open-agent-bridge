-- Latest host sample only; the authenticated adapter owns its identity's reading.
ALTER TABLE bridge_agents ADD COLUMN host_metrics jsonb;
ALTER TABLE bridge_agents ADD COLUMN host_metrics_at timestamptz;
