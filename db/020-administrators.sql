CREATE TABLE bridge_administrators (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 workspace_owner_id text NOT NULL REFERENCES "user"(id),
 username text NOT NULL CHECK(username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
 role text NOT NULL CHECK(role IN ('platform','project')),
 UNIQUE(username)
);
INSERT INTO bridge_administrators(user_id,workspace_owner_id,username,role)
 SELECT owner_id,owner_id,CASE WHEN row_number() OVER(ORDER BY owner_id)=1 THEN 'admin' ELSE 'admin-'||substr(md5(owner_id),1,12) END,'platform' FROM bridge_owner_state;
CREATE TABLE bridge_administrator_projects (
 user_id text NOT NULL REFERENCES bridge_administrators(user_id) ON DELETE CASCADE,
 project_id uuid NOT NULL REFERENCES bridge_projects(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,project_id)
);
CREATE TABLE bridge_admin_attempts(user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,started_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 1);
