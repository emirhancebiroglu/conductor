# Plan — Work/Personal Workspace Split

> **Durum:** Finalize edildi · 2026-06-02
> **Branch hedefi:** `feature/workspace-split`
> **Amaç:** Conductor'u tek bir düz alandan, iki bağlama (workspace) ayır: `work` ve `personal`. İş pipeline'larım work'te, kişisel pipeline'larım personal'da yaşar. Mimari minimum karmaşıklık + future-compatible olacak.

---

## 1. Problem ve hedef

Şu an Conductor tek düzlemde çalışıyor: `projects → jobs → runs`. Hangi job'ın iş, hangisinin kişisel olduğunu ayıran bir kavram yok. İstenen: iki bağlam, biri iş biri kişisel, kazara karışmadan.

Bu **gerçek multi-tenancy değil** — tek kullanıcı (ben). İki müşteri değil, iki **bağlam (scope/context)** ayrımı. Bu yüzden ağır izolasyon (ayrı schema, ayrı DB, RLS-per-tenant) gereksiz karmaşıklık olur. ([PlanetScale tenancy](https://planetscale.com/blog/approaches-to-tenancy-in-postgres), [AWS partitioning models](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/partitioning-models.html))

Seçilen yaklaşım: **pool model + bridge tablo** — paylaşılan DB, `workspaces` tablosu, her satır `workspace_id` ile bir bağlama ait. App katmanında filtre. Tek kullanıcı için yeterli, N bağlama genişler.

---

## 2. Kilitli kararlar

| # | Karar | Değer | Gerekçe / reddedilen |
|---|-------|-------|----------------------|
| 1 | Ayrım birimi | `workspaces` tablosu, `workspace_id` FK (enum DEĞİL) | enum `work\|personal` seni 2'ye kilitler; uuid FK ileride N bağlam (client-X, side-project) + per-workspace ayar taşır. Reddedilen: `projects.scope enum`. |
| 2 | İzolasyon | Tek Supabase DB, `workspace_id` ile app-katmanı filtre | Tek migration seti / tek realtime / tek deploy. Reddedilen: ayrı Supabase projesi (tek kullanıcıya aşırı). |
| 3 | Agent havuzu | Paylaşılır — `agent_config`, `agent_categories`, `provider_models` workspace-agnostik | Aynı agent setini iki tarafta da kullan. İleride per-workspace override eklenebilir. |
| 4 | Mevcut data | Tüm mevcut `projects` ve `jobs` → `personal` workspace'e backfill | Var olan her şey kişisel default; work projeleri sonra elle taşınır. |
| 5 | Switcher | Global toggle (sidebar üstü) + **cookie** state | Tek seferde bir bağlam görünür → kazara work job'ı personal repoya açma riski düşer. Cookie SSR+client okur, URL kirletmez. Reddedilen: URL path (tüm route refactor), localStorage (SSR okuyamaz), "All" görünüm (bağlam karışır). |
| 6 | Lane / model seçimi | **Dokunulmaz.** `agent_config` tablosu mevcut haliyle kalır | Lane/model zaten agents sayfasından yönetiliyor. Workspace lane'i etkilemez. |
| 7 | `workspaces.settings` jsonb | Şema bugün eklenir, **boş** bırakılır | İleride `github_account`, `monthly_cost_limit_usd` gibi per-workspace ayar için yer açar. Değer sonra doldurulur. |
| 8 | Entegrasyon sırası | **DB → API → UI → Worker**, her adım test edilip geçilir | Hata izolasyonu, kolay review. Reddedilen: tek dev PR. |

---

## 3. Veri modeli

### Önce (mevcut)
```
projects (id, owner, repo, default_branch, created_at)
   └─ jobs (id, project_id, type, title, ..., status)
        └─ runs (job_id, agent, ...)
        └─ usage_log (run_id, ...)
        └─ approvals (job_id, ...)
agent_config / agent_categories / provider_models   (bağımsız)
```

### Sonra (hedef)
```
workspaces (id, name, kind, settings jsonb, created_at)      ← YENİ
   └─ projects (+ workspace_id FK NOT NULL)                   ← kolon
        └─ jobs (+ workspace_id FK NOT NULL — denormalize)    ← kolon
             └─ runs / usage_log / approvals                  ← DEĞİŞMEZ (job üzerinden türetilir)
agent_config / agent_categories / provider_models             ← DEĞİŞMEZ (paylaşılır)
```

**`jobs.workspace_id` neden denormalize?** `project_id`'den join ile türetilebilir; ama her job listesi ve cost sorgusunda join'den kaçınmak için doğrudan kolon. Costs sayfası "work bu ay $X, personal $Y" tek filtre ile gelir. Tek kullanıcı ölçeğinde tutarlılık riski düşük (job oluşturulurken project'in workspace'i kopyalanır, project workspace'i sonradan değişmez varsayımı).

### `workspaces` şeması
| Kolon | Tip | Not |
|-------|-----|-----|
| `id` | uuid PK | `gen_random_uuid()` |
| `name` | text NOT NULL | görünen ad ("Work", "Personal") |
| `kind` | text NOT NULL | `'work'` \| `'personal'` (slug rolü; UI/cookie bunu kullanır) |
| `settings` | jsonb DEFAULT `'{}'` | ileride github_account/limit; şimdi boş |
| `created_at` | timestamptz DEFAULT now() | |

`kind` üzerinde unique constraint **YOK** (ileride iki "work-tipi" workspace mümkün olsun diye), ama seed'de `personal` ve `work` birer kez eklenir. Cookie `kind` değerini taşır (uuid değil — okunabilir, stabil).

---

## 4. Migration stratejisi — `007_workspaces.sql`

Sıra kritik (boş tabloda FK fail olmasın):

1. `create table workspaces (...)` + RLS enable + service-role full-access policy (mevcut `001` pattern'i).
2. **Seed**: `insert into workspaces (name, kind) values ('Personal','personal'), ('Work','work');`
3. `alter table projects add column workspace_id uuid;`
4. **Backfill**: `update projects set workspace_id = (select id from workspaces where kind='personal');`
5. `alter table projects alter column workspace_id set not null;` + `add constraint ... foreign key (workspace_id) references workspaces(id);`
6. `alter table jobs add column workspace_id uuid;`
7. **Backfill**: `update jobs set workspace_id = projects.workspace_id from projects where jobs.project_id = projects.id;`
8. `alter table jobs alter column workspace_id set not null;` + FK.
9. **Index**: `create index on projects (workspace_id);` ve `create index on jobs (workspace_id, status);`

> **Geri dönülebilirlik:** Migration salt-ekleme (additive). Rollback notu dosya başına yorum olarak yazılır (`drop column`, `drop table`) ama otomatik down-migration yok (Supabase migration düz forward).

---

## 5. Katman katman değişim

### 5.1 DB + tipler (`packages/core`)
- `007_workspaces.sql` (yukarıdaki strateji).
- `packages/core/src/types.ts`:
  - `WorkspaceKindSchema = z.enum(["work","personal"])`
  - `WorkspaceSchema` (camelCase) + `WorkspaceRowSchema` (snake_case)
  - `ProjectSchema`/`ProjectRowSchema` → `workspaceId`/`workspace_id` ekle
  - `JobSchema`/`JobRowSchema` → `workspaceId`/`workspace_id` ekle
  - `CreateJobSchema` → `workspaceId` (opsiyonel; API aktif workspace'ten doldurur)
  - Mapper'lar (varsa `_mappers.ts`) güncelle.
- `packages/core/src/__tests__/types.test.ts` → yeni alanlar için parse testi.

### 5.2 API (`apps/dashboard/app/api`)
- **Yeni helper** `lib/workspace.ts`: cookie'den `active_workspace` (kind) oku, yoksa `'personal'` default. Server-side (route'lar) ve client-side ortak util.
- **Yeni route** `GET /api/workspaces` → tüm workspace listesi (switcher için).
- **Filtre eklenecek route'lar:**
  - `GET /api/projects` → aktif workspace_id filtre
  - `GET /api/jobs` → aktif workspace_id filtre
  - `GET /api/costs` → aktif workspace_id filtre (usage_log → run → job → workspace_id join veya jobs.workspace_id üzerinden)
  - `POST /api/jobs` → aktif workspace_id yaz (+ project'in workspace'i ile tutarlılık kontrolü)
  - `POST /api/projects` → aktif workspace_id yaz
- **Değişmeyen:** `GET /api/worker-status` (global), agents/* route'ları (paylaşılır).
- **Güvenlik:** cookie yoksa veya geçersizse → `personal`'a düş, asla 500. Cross-workspace sızıntı app-katmanında engellenir (work job'ı personal filtresinde dönmez).

### 5.3 UI (`apps/dashboard`)
- `lib/workspace.ts` client tarafı: cookie get/set (`document.cookie` veya `next/headers` server'da).
- **`WorkspaceSwitcher` component** → sidebar logo'sunun altına (CTA butonlarının üstü). Work/Personal toggle. Seçim cookie'ye yazılır → sayfa re-fetch / router refresh.
- Jobs / Projects / Costs client component'leri aktif workspace değişince yeniden veri çeker (`router.refresh()` veya re-fetch).
- "Yeni Feature" / "Yeni Fikir" formları → job'a aktif workspace_id geçer (API zaten cookie'den okur, form değişikliği minimal).
- **Realtime:** dashboard realtime subscription'ları workspace değişince re-subscribe (eski workspace event sızmasın). Job listesi realtime filter'ına workspace_id ekle.

### 5.4 Worker (`apps/worker`)
- Worker job alırken `job.workspace_id` zaten DB'den gelir.
- **Bu fazda:** sadece **log context** — hangi workspace'te çalışıyor (`runner`/`processJob` log satırına ekle). Pipeline mantığı, lane, router DEĞİŞMEZ.
- **İleride (NO-OP placeholder):** `workspaces.settings.github_account` okuyup farklı github erişimi. Bugün alan geçilir, kullanılmaz.

---

## 6. Definition of Done (her adım sonu test)

| Adım | Test |
|------|------|
| **DB** | Migration lokal uygulanır; backfill doğrulanır (tüm projects/jobs `personal`); `types.test.ts` yeşil; yeni workspace satırları (personal+work) mevcut. |
| **API** | Route testleri: workspace filtresi sızdırmıyor (work job'ı personal'da görünmez); cookie yoksa default personal, 500 yok; `POST /api/jobs` aktif workspace_id yazıyor; `GET /api/workspaces` 2 satır dönüyor. |
| **UI** | Switcher e2e: toggle değişince Jobs/Projects/Costs listesi değişir; switcher component unit testi; realtime re-subscribe doğrulanır. |
| **Worker** | workspace_id log'da görünür; mevcut pipeline testleri (`processJob`, `orchestrator`, `pipeline-integration`) hâlâ yeşil. |
| **Genel (PR öncesi)** | `pnpm lint && pnpm test && pnpm test:e2e` yeşil. |

---

## 7. Riskler ve guardrail

- **Backfill sırası:** workspace satırları önce (seed), sonra FK NOT NULL — boş tabloda FK fail olmaz.
- **Cookie yokken:** API/UI default `personal`'a düşmeli, hata değil.
- **Realtime sızıntı:** workspace değişince subscription re-subscribe; yoksa eski workspace event'i gelir.
- **Generated types:** `apps/dashboard/lib/supabase/types.ts` regenerate gerekebilir (yeni kolon/tablo).
- **`jobs.workspace_id` tutarlılık:** job oluşturulurken project'in workspace'i ile eşleşmeli; API'de assert.
- **MUTLAK KURAL:** Main'e otomatik merge YOK. Migration insan onayı ister (bu migration salt-ekleme ama yine de PR'da işaretlenir). Sırlar loglanmaz.

---

## 8. Kapsam dışı (bu PR'da YOK)

- Per-workspace agent set / override (paylaşılır kalır).
- Per-workspace cost limit / github account enforcement (sadece `settings` şeması açılır, kullanılmaz).
- Workspace CRUD UI (yeni workspace ekleme/silme) — seed ile 2 workspace yeter; CRUD ileride.
- Worker'da workspace-bazlı routing/limit (sadece log context).
- URL-bazlı workspace path.

---

## 9. Sırada ne var (bu plan sonrası)

Plan tamamlanınca: work workspace'i altına birkaç **iş pipeline entegrasyonu** planlanacak (ayrı plan dosyaları). Bu split, o pipeline'ların temiz bir bağlamda yaşaması için altyapı.
