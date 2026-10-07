CREATE TABLE bridge_board_owner_reads (
  owner_actor_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES bridge_board_posts(id) ON DELETE CASCADE,
  PRIMARY KEY(owner_actor_id,post_id)
);
