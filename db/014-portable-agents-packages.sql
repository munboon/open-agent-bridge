ALTER TABLE bridge_credentials ADD COLUMN enrollment_expires_at timestamptz;
ALTER TABLE bridge_credentials ADD COLUMN public_key text;
ALTER TABLE bridge_credentials ADD COLUMN bound_at timestamptz;
ALTER TABLE bridge_agents ADD COLUMN key_bound boolean NOT NULL DEFAULT false;
CREATE TABLE bridge_request_proofs (
 credential_id uuid NOT NULL REFERENCES bridge_credentials(id) ON DELETE CASCADE,
 nonce text NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(credential_id,nonce)
);
CREATE INDEX bridge_request_proofs_expiry ON bridge_request_proofs(expires_at);
CREATE TABLE bridge_packages (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES bridge_projects(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES bridge_conversations(id) ON DELETE CASCADE,
 sender_id uuid NOT NULL REFERENCES bridge_agents(id), recipient_id uuid NOT NULL REFERENCES bridge_agents(id),
 filename text NOT NULL, size bigint NOT NULL CHECK(size>=0 AND size<=268435456), sha256 text NOT NULL,
 sensitivity text NOT NULL CHECK(sensitivity IN ('synthetic','internal','sensitive')), encryption jsonb,
 state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','ready','verified','cancelled','expired')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 verified_at timestamptz, CHECK(sender_id<>recipient_id)
);
CREATE INDEX bridge_packages_expiry ON bridge_packages(expires_at);
CREATE TABLE bridge_package_chunks (
 package_id uuid NOT NULL REFERENCES bridge_packages(id) ON DELETE CASCADE,
 part integer NOT NULL CHECK(part>=0 AND part<1024), size integer NOT NULL CHECK(size>0 AND size<=262144),
 sha256 text NOT NULL, PRIMARY KEY(package_id,part)
);
ALTER TABLE bridge_packages ADD COLUMN purged_at timestamptz;
