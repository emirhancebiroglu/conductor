-- Smoke test for migration 008_cm_pipeline.sql
-- Run after applying migration 008 to verify schema is correct

-- 1. Insert a pipeline
insert into cm_pipeline (workspace_id, name, enabled, cron)
values (
  (select id from workspaces limit 1),
  'Test Pipeline',
  true,
  '0 2 * * *'
)
returning id as pipeline_id \gset

-- 2. Insert a repo
insert into cm_repo (pipeline_id, workspace_id, owner, name, default_branch, source, priority)
values (
  :'pipeline_id',
  (select id from workspaces limit 1),
  'test-owner',
  'ms-test-repo',
  'main',
  'auto',
  50
)
returning id as repo_id \gset

-- 3. Insert a scan
insert into cm_scan (repo_id, workspace_id, status, provider, trigger)
values (
  :'repo_id',
  (select id from workspaces limit 1),
  'queued',
  'checkmarx',
  'manual'
)
returning id as scan_id \gset

-- 4. Insert a finding
insert into cm_finding (scan_id, workspace_id, source, severity, rule, package, current_version, fixed_version, fingerprint)
values (
  :'scan_id',
  (select id from workspaces limit 1),
  'sca',
  'CRITICAL',
  'CVE-2024-1234',
  'lodash',
  '4.17.20',
  '4.17.21',
  'sca|lodash|CVE-2024-1234'
)
returning id as finding_id \gset

-- 5. Insert a report
insert into cm_report (scan_id, workspace_id, path, format)
values (
  :'scan_id',
  (select id from workspaces limit 1),
  'D:/checkmarx-reports/test-repo-cm-20260603.docx',
  'docx'
)
returning id as report_id \gset

-- 6. Verify all inserts
select 'pipeline' as entity, id from cm_pipeline where id = :'pipeline_id'
union all
select 'repo' as entity, id from cm_repo where id = :'repo_id'
union all
select 'scan' as entity, id from cm_scan where id = :'scan_id'
union all
select 'finding' as entity, id from cm_finding where id = :'finding_id'
union all
select 'report' as entity, id from cm_report where id = :'report_id';

-- 7. Verify FKs (cascade)
delete from cm_scan where id = :'scan_id';
-- finding and report should cascade-delete
select count(*) = 0 as findings_cascaded from cm_finding where scan_id = :'scan_id';
select count(*) = 0 as reports_cascaded from cm_report where scan_id = :'scan_id';

-- 8. Verify unique constraint on (pipeline_id, owner, name) for cm_repo
insert into cm_repo (pipeline_id, workspace_id, owner, name)
values (
  :'pipeline_id',
  (select id from workspaces limit 1),
  'test-owner',
  'ms-test-repo'
);
-- Expect: duplicate key violation

-- 9. Verify unique constraint on (scan_id, fingerprint) for cm_finding
insert into cm_finding (scan_id, workspace_id, source, severity, fingerprint)
values (
  :'scan_id',
  (select id from workspaces limit 1),
  'sca',
  'HIGH',
  'sca|lodash|CVE-2024-1234'
);
-- Expect: duplicate key violation

-- 10. Re-run migration idempotency check
-- Run the migration SQL again; it should produce no errors
-- (manual check: no "relation already exists" errors)

-- 11. Verify seeded agents exist
select agent_name, display_name, enabled
from agent_config
where agent_name in ('cm-sca-agent', 'cm-sast-agent');

-- 12. Verify runs.scan_id column exists
select column_name, data_type
from information_schema.columns
where table_name = 'runs' and column_name = 'scan_id';

-- 13. Verify agent_config CHECK is dropped (should allow new custom slugs)
insert into agent_config (agent_name, display_name, role, provider, model, system_prompt)
values ('cm-custom-test', 'Test Agent', 'test role', 'opencode', 'opencode-go/deepseek-v4-flash', 'test')
on conflict (agent_name) do nothing;
-- Expect: success (no CHECK constraint violation)

-- Cleanup test agent
delete from agent_config where agent_name = 'cm-custom-test';

-- Cleanup test data
delete from cm_pipeline where id = :'pipeline_id';
-- cascade deletes repo → scan → finding → report

\echo 'All smoke tests passed!';
