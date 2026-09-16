CREATE FUNCTION bridge_assign_public_id() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate text; found boolean;
BEGIN
 LOOP
  candidate := substr(replace(gen_random_uuid()::text,'-',''),1,10);
  PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME),hashtext(candidate));
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE public_id=$1)',TG_TABLE_NAME) INTO found USING candidate;
  IF NOT found THEN NEW.public_id := candidate; RETURN NEW; END IF;
 END LOOP;
END $$;
ALTER TABLE bridge_projects ADD COLUMN public_id text UNIQUE CHECK(public_id ~ '^[a-f0-9]{10}$');
CREATE TRIGGER assign_public_id BEFORE INSERT OR UPDATE OF public_id ON bridge_projects FOR EACH ROW WHEN (NEW.public_id IS NULL) EXECUTE FUNCTION bridge_assign_public_id();
UPDATE bridge_projects SET public_id=NULL;
ALTER TABLE bridge_projects ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE bridge_agents ADD COLUMN public_id text UNIQUE CHECK(public_id ~ '^[a-f0-9]{10}$');
CREATE TRIGGER assign_public_id BEFORE INSERT OR UPDATE OF public_id ON bridge_agents FOR EACH ROW WHEN (NEW.public_id IS NULL) EXECUTE FUNCTION bridge_assign_public_id();
UPDATE bridge_agents SET public_id=NULL;
ALTER TABLE bridge_agents ALTER COLUMN public_id SET NOT NULL;
ALTER TABLE bridge_conversations ADD COLUMN public_id text UNIQUE CHECK(public_id ~ '^[a-f0-9]{10}$');
CREATE TRIGGER assign_public_id BEFORE INSERT OR UPDATE OF public_id ON bridge_conversations FOR EACH ROW WHEN (NEW.public_id IS NULL) EXECUTE FUNCTION bridge_assign_public_id();
UPDATE bridge_conversations SET public_id=NULL;
ALTER TABLE bridge_conversations ALTER COLUMN public_id SET NOT NULL;
