-- 003_agent_team_v2.sql
-- Faz 3: 8-agent pipeline için şema güncellemeleri (T-301/T-302)

-- Sub-job decomposition için parent referansı
alter table jobs
  add column if not exists parent_job_id uuid references jobs(id) on delete set null;

-- 'decomposed' status: complex feature → child job'lara bölündü, parent artık beklemede
-- jobs.status check constraint zaten yoktu, sadece comment güncelliyoruz:
comment on column jobs.status is
  'queued|running|decomposed|review_loop|test_loop|pr_opened|merged|failed|needs_human';

-- agent adları güncellendi (architect → tech-lead, frontend → frontend-dev, vb.)
-- runs.agent text sütunu, constraint yok, backward compatible.
comment on column runs.agent is
  'product-owner|codebase-analyst|tech-lead|backend-dev|frontend-dev|security-reviewer|code-reviewer|qa-engineer';
