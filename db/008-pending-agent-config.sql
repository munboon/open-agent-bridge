-- Keep pre-provisioned access encrypted only until its first config download.
ALTER TABLE bridge_credentials ADD COLUMN kit_envelope jsonb;
CREATE FUNCTION clear_revoked_kit_envelope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revoked_at IS NOT NULL OR NEW.expires_at <= now() THEN
    NEW.kit_envelope := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bridge_credentials_clear_kit_envelope
  BEFORE INSERT OR UPDATE ON bridge_credentials
  FOR EACH ROW EXECUTE FUNCTION clear_revoked_kit_envelope();
