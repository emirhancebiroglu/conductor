-- T-501c: idea pipeline columns on jobs table

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS prd               text,
  ADD COLUMN IF NOT EXISTS prd_approved      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS research_output   jsonb,
  ADD COLUMN IF NOT EXISTS scaffold_repo     text,
  ADD COLUMN IF NOT EXISTS parent_job_id     uuid REFERENCES jobs(id),
  ADD COLUMN IF NOT EXISTS idea_loop_count   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idea_constraints  jsonb;

-- New statuses: 'researching', 'prd_ready', 'scaffolding', 'idea_exhausted'
-- status column is plain text (no check constraint) — no constraint change needed.
