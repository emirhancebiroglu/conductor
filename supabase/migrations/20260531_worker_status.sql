CREATE TABLE IF NOT EXISTS worker_status (
  id          serial PRIMARY KEY,
  status      text NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'paused_limit', 'paused_manual')),
  reason      text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO worker_status (status) VALUES ('online')
ON CONFLICT DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE worker_status;
