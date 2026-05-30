# 01 — Architecture

## İki düzlem

```
┌─────────────────────────── CONTROL PLANE ───────────────────────────┐
│  Dashboard (Next.js + Supabase)                                       │
│  - GitHub bağla / proje seç                                           │
│  - Feature formu → job oluştur                                        │
│  - Canlı run durumu, loglar, maliyet, onay kapıları (Realtime)        │
└───────────────┬───────────────────────────────────────────────────────┘
                │ (job: queued)            ▲ (status, logs, pr_url, cost)
                ▼                          │
┌─────────────────────────── EXECUTION PLANE ──────────────────────────┐
│  Worker (long-running, VM)                                            │
│  1. job al → repoyu git worktree'ye klonla → feature branch aç        │
│  2. ORCHESTRATOR → agent ekibini sırayla/koşullu çalıştırır           │
│       PO → Architect → (FE ∥ BE) → Reviewer⟲ → Tester⟲                │
│  3. commit + push + PR aç                                             │
│  4. ROUTER her adımda ucuz/premium şerit seçer + usage_log yazar      │
└───────────────────────────────────────────────────────────────────────┘
                │
                ▼
        GitHub: feature branch + PR
                │
                ▼
        ⛔ İNSAN KAPISI → sen PR'ı incele → merge SEN yaparsın
```

**Neden iki düzlem?** OpenCode ve Claude Code gerçek bir makinede, repo checkout'u ve shell erişimiyle çalışır. Bu yüzden execution serverless olamaz; uzun ömürlü bir worker gerekir. Dashboard ise serverless (Vercel) olabilir. İkisi Supabase üzerinden konuşur.

---

## Bileşenler

### Control plane
- **Dashboard (Next.js App Router):** UI + API routes. Sadece sen giriş yaparsın.
- **Supabase:** Postgres (durum), Auth (sen), Realtime (canlı log/durum), Storage (artefakt/ekran görüntüsü).
- **GitHub App / OAuth:** repo listesi, PR açma, webhook (PR durumu).

### Execution plane
- **Worker (Node 22+):** Supabase'deki `jobs`'u dinler. Her job için izole bir git worktree.
- **Orchestrator:** agent sırasını ve döngü koşullarını yönetir (reviewer/tester pass olana kadar).
- **Router:** göreve göre şerit (cheap/premium) ve model seçer; limit guardrail'lerini uygular.
- **Agent runner'lar:**
  - *Cheap lane:* OpenCode headless + OpenCode Go modelleri (+ agent-team plugini).
  - *Premium lane:* Claude Code headless (`claude -p`, Pro login).
- **Tooling:** git, Octokit (PR), Playwright (E2E), test runner (vitest), lint.

---

## Veri akışı (feature pipeline)

1. **Sen:** proje seç + feature açıklaması gir → `POST /api/jobs` → `jobs` satırı `status=queued`.
2. **Worker:** `queued` job'u alır → `status=running`, repo klonla, `feature/<slug>` aç.
3. **PO agent:** açıklama + web araştırması → `spec` (kabul kriterleri) üretir → `runs` log.
4. **Architect agent:** `spec` → teknik plan + görev kırılımı + API kontratı.
5. **FE + BE agent:** kontrata göre koordineli implementasyon (paylaşılan `api-contract.md`).
6. **Reviewer agent (⟲):** diff'i incele → sorun varsa ilgili agent'a geri gönder → temiz olana kadar (max tur sonra insana yükselt).
7. **Tester agent (⟲):** unit + edge + logging → app'i ayağa kaldır → Playwright E2E → pass olana kadar → commit + push.
8. **PR:** Octokit ile PR aç → `jobs.status=pr_opened`, `pr_url` yaz.
9. **Sen:** dashboard'dan PR linkine git → incele → **main'e merge'ü sen yaparsın** → `jobs.status=merged` (webhook).

Her adım `runs` tablosuna yapılandırılmış log + `usage_log`'a maliyet yazar; dashboard Realtime ile canlı gösterir.

---

## Veri modeli (Supabase / Postgres — başlangıç)

```sql
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
```

---

## İnsan kapıları (nerede durur)
| Kapı | Tetik | Davranış |
|------|-------|----------|
| **Merge** | tester PR açtı | Job `pr_opened`'da durur; merge'ü sen yaparsın |
| **DB migration / yıkıcı işlem** | architect/BE migration üretti | `approvals` satırı `pending`; sen onaylamadan worker uygulamaz |
| **Belirsiz kapsam** | agent emin değil | `status=needs_human`, dashboard'da soru gösterilir |
| **Limit aşımı** | usage limit eşiği | Router premium'u kapatır, ucuza düşer veya durur (doc 08) |
| **Dış paylaşım (sonraki faz)** | marketing içerik üretildi | Daima `pending`, sen post edersin |

---

## State machine (job)
```
queued → running → (review_loop ⟲) → (test_loop ⟲) → pr_opened → merged
                                  �‖
                          needs_human / failed   (her noktadan çıkış mümkün)
```

## Güvenlik
- Sırlar Supabase secrets / VM env'de; repoya asla girmez.
- Worker repolara fine-grained, minimum yetkiyle erişir (contents + PR; admin yok).
- Webhook imzaları doğrulanır.
- Detay: `docs/10_RISKS_AND_GUARDRAILS.md`.
