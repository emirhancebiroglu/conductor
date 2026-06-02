-- 007_workspaces.sql
-- Work/Personal namespace ayırma (plan::workspace-split)
-- Rollback: drop table workspaces cascade; alter table projects drop column workspace_id; alter table jobs drop column workspace_id;

-- 1. workspace'ler
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,
  settings jsonb default '{}',
  created_at timestamptz default now()
);

alter table workspaces enable row level security;
create policy "service role full access" on workspaces for all using (true);

-- 2. seed
insert into workspaces (name, kind) values ('Personal', 'personal'), ('Work', 'work');

-- 3. projects'e workspace_id ekle
alter table projects add column workspace_id uuid;

-- 4. backfill → tüm mevcut projeler personal workspace'ine
update projects set workspace_id = (select id from workspaces where kind = 'personal');

-- 5. projects.workspace_id → not null + FK
alter table projects alter column workspace_id set not null;
alter table projects add constraint projects_workspace_id_fkey foreign key (workspace_id) references workspaces (id);

-- 6. jobs'a workspace_id ekle
alter table jobs add column workspace_id uuid;

-- 7. backfill → job'lar ilgili project'in workspace'ini alır
update jobs set workspace_id = projects.workspace_id from projects where jobs.project_id = projects.id;

-- 8. jobs.workspace_id → not null + FK
alter table jobs alter column workspace_id set not null;
alter table jobs add constraint jobs_workspace_id_fkey foreign key (workspace_id) references workspaces (id);

-- 9. index
create index idx_projects_workspace_id on projects (workspace_id);
create index idx_jobs_workspace_id_status on jobs (workspace_id, status);
