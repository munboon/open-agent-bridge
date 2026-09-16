-- Retrieval is distinct from acknowledgement. Historical retrieval is unknown.
ALTER TABLE bridge_messages ADD COLUMN retrieved_at timestamptz;
