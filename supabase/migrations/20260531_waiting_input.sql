-- T-406: waiting_input flow
-- status column is text (no enum); just add answers column.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS answers jsonb DEFAULT NULL;
