-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006: Agent Categories + open-ended agent CRUD
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create agent_categories table
create table if not exists agent_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  color       text not null default '#7a7468',
  description text,
  "order"     integer not null default 0,
  created_at  timestamptz default now()
);

alter table agent_categories enable row level security;

create policy "authed can read categories"
  on agent_categories for select
  using (auth.role() = 'authenticated');

create policy "authed can write categories"
  on agent_categories for all
  using (auth.role() = 'authenticated');

-- 2. Seed 4 default categories (fixed UUIDs for stable FK references in tests)
insert into agent_categories (id, name, slug, color, description, "order") values
  ('10000000-0000-0000-0000-000000000001', 'Planning',     'planning',     '#818cf8', 'Spec, analysis, and architecture agents', 1),
  ('10000000-0000-0000-0000-000000000002', 'Development',  'development',  '#34d399', 'Backend and frontend implementation agents', 2),
  ('10000000-0000-0000-0000-000000000003', 'Quality',      'quality',      '#f59e0b', 'Code review, testing, and validation agents', 3),
  ('10000000-0000-0000-0000-000000000004', 'Security',     'security',     '#f87171', 'Security audit and hardening agents', 4)
on conflict (id) do nothing;

-- 3. Alter agent_config

-- 3a. Drop the hardcoded 8-name CHECK constraint (keep UNIQUE constraint on agent_name)
alter table agent_config drop constraint if exists agent_config_agent_name_check;

-- 3b. Add category FK (nullable — uncategorized agents are valid)
alter table agent_config
  add column if not exists category_id uuid references agent_categories(id) on delete set null;

-- 3c. Add skill_content column (stores actual markdown content, not a file path)
alter table agent_config
  add column if not exists skill_content text;

-- 3d. Drop skill_path column (superseded by skill_content; 8 agents migrated via seed script)
alter table agent_config drop column if exists skill_path;

-- 4. Assign existing 8 agents to their categories
update agent_config
  set category_id = '10000000-0000-0000-0000-000000000001'
  where agent_name in ('product-owner', 'codebase-analyst', 'tech-lead');

update agent_config
  set category_id = '10000000-0000-0000-0000-000000000002'
  where agent_name in ('backend-dev', 'frontend-dev');

update agent_config
  set category_id = '10000000-0000-0000-0000-000000000003'
  where agent_name in ('code-reviewer', 'qa-engineer');

update agent_config
  set category_id = '10000000-0000-0000-0000-000000000004'
  where agent_name in ('security-reviewer');

-- Note: skill_content seeded separately via scripts/seed-skill-content.ts
-- Run: pnpm tsx scripts/seed-skill-content.ts  after applying this migration
