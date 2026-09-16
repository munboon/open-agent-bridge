-- Null retains the role default: developer visible, deployment quiet.
ALTER TABLE bridge_agents ADD COLUMN chat_visible boolean;
