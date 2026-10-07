-- The project board is separate from private, two-participant conversations.
CREATE TABLE bridge_boards (
  project_id uuid PRIMARY KEY REFERENCES bridge_projects(id) ON DELETE CASCADE,
  next_sequence bigint NOT NULL DEFAULT 1,
  retained_after bigint NOT NULL DEFAULT 0
);
CREATE TABLE bridge_board_posts (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES bridge_boards(project_id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  sender_id uuid REFERENCES bridge_agents(id),
  author_type text NOT NULL CHECK (author_type IN ('owner','agent')),
  owner_actor_id text,
  parent_id uuid,
  root_id uuid NOT NULL,
  required_agents uuid[] NOT NULL DEFAULT '{}',
  audience_agent_ids uuid[],
  kind text NOT NULL CHECK (kind IN ('update','finding','decision','blocker')),
  body text NOT NULL CHECK (octet_length(body)<=65536),
  pinned boolean NOT NULL DEFAULT false,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id,sequence),
  UNIQUE(id,project_id),
  FOREIGN KEY(parent_id,project_id) REFERENCES bridge_board_posts(id,project_id),
  CHECK ((author_type='agent' AND sender_id IS NOT NULL AND owner_actor_id IS NULL)
    OR (author_type='owner' AND sender_id IS NULL AND owner_actor_id IS NOT NULL))
);
CREATE INDEX bridge_board_posts_root ON bridge_board_posts(project_id,root_id,sequence);
CREATE TABLE bridge_board_reads (
  agent_id uuid NOT NULL REFERENCES bridge_agents(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES bridge_board_posts(id) ON DELETE CASCADE,
  PRIMARY KEY(agent_id,post_id)
);
