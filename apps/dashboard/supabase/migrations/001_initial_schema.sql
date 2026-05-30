-- 001_initial_schema.sql
-- Conductor başlangıç şeması (docs/01_ARCHITECTURE.md'den birebir)

-- bağlı GitHub projeleri
create table projects (
  id uuid primary key default gen_random_uuid(),
  owner text not null,            -- github org/user
  repo  text not null,            -- repo adı
  default_branch text default 'main',
  created_at timestamptz default now()
);

-- bir feature/idea isteği
create table jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  type text not null default 'feature',     -- 'feature' | 'idea'
  title text not null,
  description text not null,                  -- senin kısa açıklaman
  lane_preference text default 'auto',        -- 'auto' | 'cheap' | 'premium'
  status text not null default 'queued',      -- queued|running|review_loop|test_loop|pr_opened|merged|failed|needs_human
  branch text,
  pr_url text,
  spec jsonb,                                 -- PO çıktısı
  plan jsonb,                                 -- architect çıktısı
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- her agent adımının kaydı (log + handoff)
create table runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  agent text not null,             -- 'product-owner' | 'architect' | ...
  lane text,                       -- 'cheap' | 'premium'
  model text,
  status text not null,            -- started|ok|retry|failed
  input jsonb,
  output jsonb,
  log text,
  iteration int default 1,         -- reviewer/tester döngü turu
  created_at timestamptz default now()
);

-- maliyet/limit takibi
create table usage_log (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references runs(id) on delete cascade,
  provider text,                   -- 'opencode-go' | 'anthropic'
  model text,
  input_tokens int,
  output_tokens int,
  est_cost_usd numeric(10,4),
  created_at timestamptz default now()
);

-- insan onayı bekleyen tehlikeli işlemler
create table approvals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  kind text not null,              -- 'db_migration' | 'merge' | 'external_post' ...
  payload jsonb,
  status text default 'pending',   -- pending|approved|rejected
  decided_at timestamptz
);

-- updated_at otomatik güncelleme trigger'ı
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger jobs_updated_at
  before update on jobs
  for each row execute function set_updated_at();

-- Realtime için row-level security (RLS) — tek kullanıcı, şimdilik basit
alter table projects enable row level security;
alter table jobs enable row level security;
alter table runs enable row level security;
alter table usage_log enable row level security;
alter table approvals enable row level security;

-- service_role her şeyi okuyup yazabilir
create policy "service role full access" on projects for all using (true);
create policy "service role full access" on jobs for all using (true);
create policy "service role full access" on runs for all using (true);
create policy "service role full access" on usage_log for all using (true);
create policy "service role full access" on approvals for all using (true);
