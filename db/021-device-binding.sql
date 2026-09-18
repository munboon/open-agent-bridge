ALTER TABLE bridge_credentials ADD COLUMN device_required boolean NOT NULL DEFAULT false;
ALTER TABLE bridge_credentials ADD COLUMN device_binding text;
ALTER TABLE bridge_credentials ADD COLUMN connection_challenge text;
ALTER TABLE bridge_credentials ADD COLUMN challenge_expires_at timestamptz;
