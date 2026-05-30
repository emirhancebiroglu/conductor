-- 002_jobs_started_at.sql
-- Add started_at to jobs for worker timing

alter table jobs add column if not exists started_at timestamptz;
