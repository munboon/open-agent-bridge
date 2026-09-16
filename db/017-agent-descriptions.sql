ALTER TABLE bridge_agents ADD COLUMN description text CHECK (char_length(description) <= 1000);
