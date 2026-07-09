-- 009_add_cm_category.sql
-- Mirrored from apps/dashboard/supabase/migrations/009_add_cm_category.sql

-- 1. Insert CM category
insert into agent_categories (id, name, slug, color, description, "order") values
  ('10000000-0000-0000-0000-000000000005', 'CM Pipeline', 'cm', '#a78bfa', 'Checkmarx auto-scan and auto-fix agents', 5)
on conflict (id) do nothing;

-- 2. Update CM agents to point to the new category
update agent_config
  set category_id = '10000000-0000-0000-0000-000000000005'
  where agent_name in ('cm-sca-agent', 'cm-sast-agent');

-- 3. Ensure proper ordering
update agent_config
  set "order" = 1
  where agent_name = 'cm-sca-agent' and "order" != 1;

update agent_config
  set "order" = 2
  where agent_name = 'cm-sast-agent' and "order" != 2;
