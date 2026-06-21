-- 010_agent_allowed_tools.sql
-- Mirror of supabase/migrations/20260604_agent_allowed_tools.sql
-- Add per-agent allowed_tools column + seed missing CM agents

ALTER TABLE agent_config
  ADD COLUMN IF NOT EXISTS allowed_tools text[] NOT NULL DEFAULT '{}';

-- Seed tool sets for existing CM agents
UPDATE agent_config SET allowed_tools = ARRAY['tavily', 'context7', 'edit', 'shell']
  WHERE agent_name = 'cm-sca-agent';

UPDATE agent_config SET allowed_tools = ARRAY['context7', 'edit', 'shell']
  WHERE agent_name = 'cm-sast-agent';

-- Insert missing CM pipeline agents if they don't exist
INSERT INTO agent_config (
  agent_name, display_name, role, provider, model, system_prompt,
  skill_content, category_id, enabled, lane_override, "order", allowed_tools
)
SELECT
  'cm-fix-planner',
  'CM Fix Planner',
  'Checkmarx fix-planning agent: triages actionable findings, assesses reachability and exploitability via web research, selects fix strategy (upgrade/code-fix/skip) and target version per finding, returns a structured fix plan.',
  'claude',
  'claude-sonnet-4-6',
  'You are a security fix planning agent. Analyze the provided security findings, assess their real-world exploitability and reachability in context, then produce a structured JSON fix plan. Use Tavily to research CVE advisories and GitHub issues. Use context7 for library-specific guidance. Research breaking changes before deciding target versions.',
  NULL,
  (SELECT id FROM agent_categories WHERE slug = 'cm' LIMIT 1),
  true,
  NULL,
  9,
  ARRAY['tavily', 'github', 'context7']
WHERE NOT EXISTS (SELECT 1 FROM agent_config WHERE agent_name = 'cm-fix-planner');

INSERT INTO agent_config (
  agent_name, display_name, role, provider, model, system_prompt,
  skill_content, category_id, enabled, lane_override, "order", allowed_tools
)
SELECT
  'cm-fix-verifier',
  'CM Fix Verifier',
  'Checkmarx fix-verification agent: runs the project build and test suite after fixes are applied, reports regressions, and confirms the fix branch is ready for PR.',
  'opencode',
  'opencode-go/deepseek-v4-flash',
  'You are a security fix verification agent. Run the provided build command and test command in the working directory. Report whether all tests pass, identify any regressions introduced by the security fixes, and confirm the codebase compiles cleanly. Output a concise pass/fail summary.',
  NULL,
  (SELECT id FROM agent_categories WHERE slug = 'cm' LIMIT 1),
  true,
  NULL,
  10,
  ARRAY['edit', 'shell']
WHERE NOT EXISTS (SELECT 1 FROM agent_config WHERE agent_name = 'cm-fix-verifier');
