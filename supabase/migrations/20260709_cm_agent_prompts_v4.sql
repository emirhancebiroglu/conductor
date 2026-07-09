-- 20260709_cm_agent_prompts_v4.sql
-- cm-sca-agent and cm-sast-agent system prompts never had an explicit "Output"
-- section — the code (sca.ts/sast.ts) parses each agent's final message as
-- CmBatchFixResultSchema ({"results":[{fingerprint, fixStatus, notes}]}), and
-- until now the per-task description carried that schema reminder every
-- dispatch. As part of de-duplicating per-task descriptions (moving durable
-- instructions to the DB system_prompt, out of the repeated task text), the
-- output schema must live in the system_prompt instead, or the agent has no
-- way to know the required JSON shape at all — this fixes a real gap, not
-- just a dedup.
-- Mirror of apps/dashboard/supabase/migrations/016_cm_agent_prompts_v4.sql

DO $cm_migration_v4$
DECLARE
  sca_output text := $out$

## Output (STRICT)
Return your final message as ONLY a valid JSON object (no markdown fences, no extra prose) matching this schema:
{
  "results": [
    { "fingerprint": "<exact fingerprint from input>", "fixStatus": "fixed" | "failed" | "skipped", "notes": "<what you did, the confirmed resolved version, or why it failed>" }
  ]
}
$out$;
  sast_output text := $out$

## Output (STRICT)
Return your final message as ONLY a valid JSON object (no markdown fences, no extra prose) matching this schema:
{
  "results": [
    { "fingerprint": "<exact fingerprint from input>", "fixStatus": "fixed" | "failed" | "skipped", "notes": "<file, the sink fixed, and the technique used, or why it failed>" }
  ]
}
$out$;
BEGIN
  UPDATE agent_config
  SET system_prompt = system_prompt || sca_output, updated_at = now()
  WHERE agent_name = 'cm-sca-agent' AND system_prompt NOT LIKE '%## Output (STRICT)%';

  UPDATE agent_config
  SET system_prompt = system_prompt || sast_output, updated_at = now()
  WHERE agent_name = 'cm-sast-agent' AND system_prompt NOT LIKE '%## Output (STRICT)%';
END $cm_migration_v4$;
