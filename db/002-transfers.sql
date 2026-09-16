CREATE TABLE IF NOT EXISTS bridge_recipient_keys (
  agent_id uuid PRIMARY KEY REFERENCES bridge_agents(id), scheme text NOT NULL CHECK(scheme='age'),
  public_key text NOT NULL, fingerprint text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bridge_transfers (
  id uuid PRIMARY KEY, project_id uuid NOT NULL, environment_id uuid NOT NULL, conversation_id uuid NOT NULL,
  source_id uuid NOT NULL, destination_id uuid NOT NULL, host_id uuid NOT NULL, task_id uuid,
  direction text NOT NULL CHECK(direction IN ('download','upload')), manifest jsonb NOT NULL,
  state text NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','offered','in_progress','awaiting_verification','verified','failed','expired','cancelled')),
  cleanup_state text NOT NULL DEFAULT 'pending' CHECK(cleanup_state IN ('pending','confirmed','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(conversation_id,project_id,environment_id) REFERENCES bridge_conversations(id,project_id,environment_id),
  FOREIGN KEY(source_id,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  FOREIGN KEY(destination_id,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  FOREIGN KEY(host_id,project_id,environment_id) REFERENCES bridge_agents(id,project_id,environment_id),
  FOREIGN KEY(task_id,project_id,environment_id) REFERENCES bridge_tasks(id,project_id,environment_id)
);
CREATE TABLE IF NOT EXISTS bridge_offers (
  id uuid PRIMARY KEY, transfer_id uuid NOT NULL REFERENCES bridge_transfers(id), origin text NOT NULL,
  envelope jsonb, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bridge_receipts (
  id uuid PRIMARY KEY, transfer_id uuid NOT NULL REFERENCES bridge_transfers(id), offer_id uuid NOT NULL REFERENCES bridge_offers(id),
  reporter_id uuid NOT NULL REFERENCES bridge_agents(id), kind text NOT NULL CHECK(kind IN ('uploaded','verified','failed')),
  measured_size bigint NOT NULL, measured_sha256 text NOT NULL, evidence text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
