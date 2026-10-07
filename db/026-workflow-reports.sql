-- Owner-only activity reports do not expose an agent's work to its peers.
ALTER TABLE bridge_agents ADD COLUMN activity_report jsonb;
ALTER TABLE bridge_packages ADD COLUMN handoff jsonb;

-- File integrity and recipient work outcomes are separate, retained records.
CREATE TABLE bridge_package_outcomes (
  id uuid PRIMARY KEY,
  package_id uuid NOT NULL REFERENCES bridge_packages(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES bridge_agents(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('accepted','validated','applied','completed','blocked','failed')),
  evidence text NOT NULL CHECK (length(evidence) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bridge_package_outcomes_history ON bridge_package_outcomes(package_id,created_at DESC,id DESC);
