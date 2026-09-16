ALTER TABLE bridge_conversations ADD COLUMN kind text NOT NULL DEFAULT 'peer' CHECK(kind IN ('peer','owner'));
ALTER TABLE bridge_conversations DROP CONSTRAINT bridge_conversations_check;
ALTER TABLE bridge_conversations ADD CONSTRAINT bridge_conversation_participants CHECK (
  (kind='peer' AND agent_a<agent_b) OR (kind='owner' AND agent_a=agent_b)
);
