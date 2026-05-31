-- 004_worker_status.sql
-- T-403: worker durumu — poll döngüsü hard limit'te duraklatılır

create table if not exists worker_status (
  id         uuid primary key default gen_random_uuid(),
  status     text not null check (status in ('online', 'paused_limit', 'paused_manual')),
  reason     text,
  updated_at timestamptz default now()
);

insert into worker_status (status)
values ('online')
on conflict do nothing;
