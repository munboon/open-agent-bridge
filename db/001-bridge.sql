CREATE TABLE IF NOT EXISTS bridge_projects (
  id uuid PRIMARY KEY, owner_id text NOT NULL, name text NOT NULL, client_label text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','archived')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,owner_id)
);
CREATE TABLE IF NOT EXISTS bridge_environments (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES bridge_projects(id), name text NOT NULL,
  UNIQUE(project_id,name), UNIQUE(id,project_id)
);
CREATE TABLE IF NOT EXISTS bridge_agents (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, environment_id uuid NOT NULL,
  name text NOT NULL, role text NOT NULL CHECK(role IN ('development','deployment')),
  active boolean NOT NULL DEFAULT true, generation integer NOT NULL DEFAULT 0,
  session_id uuid, last_seen_at timestamptz,
  FOREIGN KEY(environment_id,project_id) REFERENCES bridge_environments(id,project_id),
  UNIQUE(id,project_id,environment_id)
);
CREATE TABLE IF NOT EXISTS bridge_credentials (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES bridge_agents(id),
  digest text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bridge_pairings (
  project_id uuid NOT NULL, environment_id uuid NOT NULL, agent_a uuid NOT NULL, agent_b uuid NOT NULL,
  PRIMARY KEY(agent_a,agent_b), CHECK(agent_a < agent_b),
  FOREIGN KEY(agent_a,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  FOREIGN KEY(agent_b,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id)
);
CREATE TABLE IF NOT EXISTS bridge_conversations (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, environment_id uuid NOT NULL,
  agent_a uuid NOT NULL, agent_b uuid NOT NULL, next_sequence bigint NOT NULL DEFAULT 1,
  retained_after bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(agent_a < agent_b), UNIQUE(agent_a,agent_b),
  FOREIGN KEY(agent_a,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  FOREIGN KEY(agent_b,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  UNIQUE(id,project_id,environment_id)
);
CREATE TABLE IF NOT EXISTS bridge_tasks (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, environment_id uuid NOT NULL,
  conversation_id uuid NOT NULL, requester_id uuid NOT NULL, assignee_id uuid NOT NULL,
  title text NOT NULL, instructions text NOT NULL, state text NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','claimed','awaiting_reply','completed','failed','cancel_requested','cancelled','needs_reconciliation')),
  claim_generation integer NOT NULL DEFAULT 0, session_generation integer, lease_until timestamptz,
  result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(conversation_id,project_id,environment_id) REFERENCES bridge_conversations(id,project_id,environment_id),
  FOREIGN KEY(requester_id,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  FOREIGN KEY(assignee_id,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  UNIQUE(id,project_id,environment_id)
);
CREATE TABLE IF NOT EXISTS bridge_messages (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, environment_id uuid NOT NULL, conversation_id uuid NOT NULL,
  sequence bigint NOT NULL, sender_id uuid, author_type text NOT NULL CHECK(author_type IN ('agent','owner','system')),
  recipient_agent_id uuid NOT NULL, type text NOT NULL, body text NOT NULL,
  task_id uuid, resource_id uuid, created_at timestamptz NOT NULL DEFAULT now(), acknowledged_at timestamptz,
  FOREIGN KEY(conversation_id,project_id,environment_id) REFERENCES bridge_conversations(id,project_id,environment_id),
  FOREIGN KEY(sender_id,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  FOREIGN KEY(recipient_agent_id,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  FOREIGN KEY(task_id,project_id,environment_id) REFERENCES bridge_tasks(id,project_id,environment_id),
  UNIQUE(conversation_id,sequence), CHECK(octet_length(body) <= 65536)
);
CREATE INDEX IF NOT EXISTS bridge_inbox ON bridge_messages(recipient_agent_id,created_at) WHERE acknowledged_at IS NULL;
CREATE TABLE IF NOT EXISTS bridge_idempotency (
  actor_id text NOT NULL, operation text NOT NULL, key_digest text NOT NULL, request_digest text NOT NULL,
  response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,operation,key_digest)
);
CREATE TABLE IF NOT EXISTS bridge_audit (
  id bigserial PRIMARY KEY, owner_id text NOT NULL, project_id uuid, actor_id text NOT NULL,
  action text NOT NULL, resource_id text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bridge_rate_windows (
  actor_id text NOT NULL, window_start bigint NOT NULL, count integer NOT NULL,
  PRIMARY KEY(actor_id,window_start)
);
