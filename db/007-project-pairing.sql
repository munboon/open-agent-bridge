-- Hosts may use different environment labels; project and explicit pairing
-- remain the authorization boundary between the two registered identities.
ALTER TABLE bridge_agents ADD CONSTRAINT bridge_agents_id_project UNIQUE(id,project_id);
DO $$
DECLARE item record; cols text;
BEGIN
  FOR item IN SELECT oid,conrelid,conname,conkey FROM pg_constraint
    WHERE contype='f' AND confrelid='bridge_agents'::regclass AND cardinality(conkey)=3
  LOOP
    SELECT string_agg(quote_ident(a.attname),',' ORDER BY k.ordinality) INTO cols
      FROM unnest(item.conkey) WITH ORDINALITY k(attnum,ordinality)
      JOIN pg_attribute a ON a.attrelid=item.conrelid AND a.attnum=k.attnum
      WHERE a.attname<>'environment_id';
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',item.conrelid::regclass,item.conname);
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES bridge_agents(id,project_id)',item.conrelid::regclass,item.conname,cols);
  END LOOP;
END $$;
ALTER TABLE bridge_pairings ADD FOREIGN KEY(environment_id,project_id) REFERENCES bridge_environments(id,project_id);
ALTER TABLE bridge_conversations ADD FOREIGN KEY(environment_id,project_id) REFERENCES bridge_environments(id,project_id);
