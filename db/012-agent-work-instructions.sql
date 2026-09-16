ALTER TABLE bridge_agents
  ADD COLUMN prompt_template text CHECK (prompt_template IN ('development','deployment','discovery')),
  ADD COLUMN work_instructions text CHECK (char_length(work_instructions) BETWEEN 1 AND 16000),
  ADD COLUMN instructions_revision integer NOT NULL DEFAULT 0;
