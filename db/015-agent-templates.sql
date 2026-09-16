ALTER TABLE bridge_agents DROP CONSTRAINT bridge_agents_prompt_template_check;
ALTER TABLE bridge_agents ADD CONSTRAINT bridge_agents_prompt_template_check CHECK (prompt_template IN ('development','deployment','discovery','planner','operations','support_l1','support_l2','support_l3','custom'));
