-- Explicit owner choices must survive automatic discovery on future sign-ins.
CREATE TABLE bridge_pairing_blocks (
  project_id uuid NOT NULL,
  agent_a uuid NOT NULL,
  agent_b uuid NOT NULL,
  PRIMARY KEY(agent_a,agent_b),
  CHECK(agent_a < agent_b),
  FOREIGN KEY(agent_a,project_id) REFERENCES bridge_agents(id,project_id) ON DELETE CASCADE,
  FOREIGN KEY(agent_b,project_id) REFERENCES bridge_agents(id,project_id) ON DELETE CASCADE
);
