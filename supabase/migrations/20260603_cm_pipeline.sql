-- 008_cm_pipeline.sql
-- Checkmarx Pipeline schema: auto-scan & auto-fix pipeline tables
-- Mirrored from apps/dashboard/supabase/migrations/008_cm_pipeline.sql

-- 1. cm_pipeline — a configurable pipeline (one per workspace in v1)
create table if not exists cm_pipeline (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null default 'Checkmarx Pipeline',
  enabled boolean not null default false,
  cron text not null default '0 0 * * *',
  discovery_name_prefix text not null default 'ms',
  discovery_config_path text not null default '.github/checkmarx_scan.yml',
  severity_threshold text[] not null default array['CRITICAL','HIGH'],
  sca_test_policy text not null default 'skip-minor',
  fix_branch text not null default 'checkmarx-auto',
  report_dir text not null default 'D:/checkmarx-reports',
  retry_cooldown_seconds int not null default 1800,
  max_fix_attempts int not null default 2,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. cm_repo — repos registered for processing
create table if not exists cm_repo (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references cm_pipeline(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  owner text not null,
  name text not null,
  default_branch text not null default 'main',
  source text not null default 'auto',
  priority int not null default 100,
  enabled boolean not null default true,
  run_config jsonb,
  last_scan_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint cm_repo_pipeline_owner_name_key unique (pipeline_id, owner, name)
);

-- 3. cm_scan — one scan execution
create table if not exists cm_scan (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references cm_repo(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  status text not null default 'queued',
  provider text not null default 'checkmarx',
  external_scan_id text,
  branch_scanned text,
  trigger text not null default 'schedule',
  findings_total int default 0,
  findings_actionable int default 0,
  error text,
  current_step text,
  pr_url text,
  report_path text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. cm_finding — individual findings (SCA or SAST)
create table if not exists cm_finding (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references cm_scan(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null,
  severity text not null,
  rule text,
  package text,
  current_version text,
  fixed_version text,
  upgrade_impact text,
  file text,
  line int,
  fingerprint text not null,
  fix_status text not null default 'open',
  fix_attempts int not null default 0,
  fix_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint cm_finding_scan_fingerprint_key unique (scan_id, fingerprint)
);

-- 5. cm_report — generated report artifacts
create table if not exists cm_report (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references cm_scan(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  path text not null,
  format text not null default 'docx',
  created_at timestamptz default now()
);

-- 6. Enable RLS on all new tables
alter table cm_pipeline enable row level security;
alter table cm_repo enable row level security;
alter table cm_scan enable row level security;
alter table cm_finding enable row level security;
alter table cm_report enable row level security;

-- 7. Service role full access policies
drop policy if exists "service role full access" on cm_pipeline;
create policy "service role full access" on cm_pipeline for all using (true);

drop policy if exists "service role full access" on cm_repo;
create policy "service role full access" on cm_repo for all using (true);

drop policy if exists "service role full access" on cm_scan;
create policy "service role full access" on cm_scan for all using (true);

drop policy if exists "service role full access" on cm_finding;
create policy "service role full access" on cm_finding for all using (true);

drop policy if exists "service role full access" on cm_report;
create policy "service role full access" on cm_report for all using (true);

-- 8. updated_at triggers on tables that have the column
drop trigger if exists cm_pipeline_updated_at on cm_pipeline;
create trigger cm_pipeline_updated_at
  before update on cm_pipeline
  for each row execute function set_updated_at();

drop trigger if exists cm_repo_updated_at on cm_repo;
create trigger cm_repo_updated_at
  before update on cm_repo
  for each row execute function set_updated_at();

drop trigger if exists cm_scan_updated_at on cm_scan;
create trigger cm_scan_updated_at
  before update on cm_scan
  for each row execute function set_updated_at();

drop trigger if exists cm_finding_updated_at on cm_finding;
create trigger cm_finding_updated_at
  before update on cm_finding
  for each row execute function set_updated_at();

-- 9. Drop agent_config.agent_name CHECK constraint (allow custom slugs like cm-sca-agent)
alter table agent_config drop constraint if exists agent_config_agent_name_check;

-- 10. Add cm_scan reference to runs table + make job_id nullable
alter table runs add column if not exists scan_id uuid references cm_scan(id);
alter table runs alter column job_id drop not null;

-- 11. Seed CM agents in agent_config
insert into agent_config (
  agent_name,
  display_name,
  role,
  provider,
  model,
  system_prompt,
  skill_content,
  enabled,
  lane_override,
  "order",
  category_id
)
values
  (
    'cm-sca-agent',
    'CM SCA Agent',
    'Checkmarx SCA dependency-upgrade agent: analyzes SCA findings, selects target versions, applies safe upgrades respecting semver impact (MINOR/MID/MAJOR), and verifies with project tests.',
    'opencode',
    'opencode-go/deepseek-v4-flash',
    '---
name: cm-sca-agent
description: SCA dependency-upgrade agent for the Checkmarx auto-fix pipeline.
---

# CM SCA Agent

You are part of the Checkmarx auto-fix pipeline. Your job is to fix SCA (Software Composition Analysis) findings by upgrading vulnerable dependencies.

## Input
You receive an SCA finding with:
- package: the vulnerable package name
- current_version: the version currently used
- fixed_version: the safe version to upgrade to
- upgrade_impact: MINOR | MID | MAJOR (semver classification)

## Process
1. Locate the dependency declaration (package.json, pom.xml, build.gradle, etc.)
2. Update the version to the target fixed_version
3. Run the project build/tests to verify the upgrade works
4. If tests fail, revert and report the failure

## Rules
- NEVER change more than the version string
- NEVER introduce new dependencies
- If the fixed_version introduces a breaking API change (MAJOR), note it in output
- Do NOT commit or push — the pipeline handles that',
    null,
    true,
    null,
    10,
    '10000000-0000-0000-0000-000000000004'
  ),
  (
    'cm-sast-agent',
    'CM SAST Agent',
    'Checkmarx SAST code-fix agent: analyzes SAST findings (SQLi, XSS, etc.), applies targeted code fixes, and verifies behavior is preserved before/after.',
    'opencode',
    'opencode-go/deepseek-v4-flash',
    '---
name: cm-sast-agent
description: SAST code-fix agent for the Checkmarx auto-fix pipeline.
---

# CM SAST Agent

You are part of the Checkmarx auto-fix pipeline. Your job is to fix SAST (Static Application Security Testing) findings by applying targeted code fixes.

## Input
You receive a SAST finding with:
- rule: the vulnerability type (e.g. SQL Injection, XSS)
- file: the file containing the vulnerability
- line: the approximate line number

## Process
1. Read the vulnerable file and understand the context
2. Apply a minimal, targeted fix (parameterized query for SQLi, output encoding for XSS, etc.)
3. Verify the fix preserves the original behavior
4. If behavior changes, revert and report the failure

## Rules
- NEVER change more than necessary to fix the vulnerability
- NEVER introduce new dependencies
- Fixes must preserve the original behavior (before/after gate)
- Do NOT commit or push — the pipeline handles that',
    null,
    true,
    null,
    11,
    '10000000-0000-0000-0000-000000000004'
  )
on conflict (agent_name) do update set
  display_name = excluded.display_name,
  role = excluded.role,
  provider = excluded.provider,
  model = excluded.model,
  system_prompt = excluded.system_prompt,
  skill_content = excluded.skill_content,
  enabled = excluded.enabled,
  "order" = excluded."order",
  category_id = excluded.category_id;
