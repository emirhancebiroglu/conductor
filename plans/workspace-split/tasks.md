# Tasks — Work/Personal Workspace Split

> **Plan:** [plan.md](./plan.md) · **Prompts:** [prompts.md](./prompts.md)
> **Branch:** `feature/workspace-split`
> Her task atomik, pürüzsüz implemente edilebilir, **sonunda test** içerir. Sıra: DB → API → UI → Worker. Bir task yeşil olmadan sonrakine geçme.

---

## Faz 0 — Hazırlık

### T-000 · Branch aç
- `feature/workspace-split` branch'ini `main`'den (veya mevcut çalışma branch'inden) aç.
- **Test:** `git branch --show-current` → `feature/workspace-split`.
- **DoD:** Branch aktif, working tree temiz.

---

## Faz 1 — DB + Tipler

### T-101 · Migration `007_workspaces.sql`
- Dosya: `apps/dashboard/supabase/migrations/007_workspaces.sql`.
- İçerik (sıra kritik — [plan.md §4](./plan.md)):
  1. `create table workspaces (id uuid pk default gen_random_uuid(), name text not null, kind text not null, settings jsonb default '{}', created_at timestamptz default now());`
  2. RLS enable + service-role full-access policy (001 pattern'i birebir).
  3. Seed: `insert into workspaces (name, kind) values ('Personal','personal'), ('Work','work');`
  4. `alter table projects add column workspace_id uuid;`
  5. Backfill: projects → personal workspace id.
  6. `projects.workspace_id` set not null + FK references workspaces(id).
  7. `alter table jobs add column workspace_id uuid;`
  8. Backfill: jobs.workspace_id = projects.workspace_id (join project_id).
  9. `jobs.workspace_id` set not null + FK.
  10. Index: `projects(workspace_id)`, `jobs(workspace_id, status)`.
- Dosya başına rollback notu yorum olarak (`-- rollback: drop table workspaces cascade; alter table ... drop column workspace_id;`).
- **Test:**
  - Migration lokal uygulanır (supabase local veya hedef proje). Hata yok.
  - `select count(*) from workspaces;` → 2.
  - `select count(*) from projects where workspace_id is null;` → 0.
  - `select count(*) from jobs where workspace_id is null;` → 0.
  - Tüm mevcut projects/jobs `personal` workspace'inde.
- **DoD:** Migration idempotent değilse en azından tek seferde temiz uygulanır; backfill doğrulandı.

### T-102 · Core tipler — `packages/core/src/types.ts`
- Ekle:
  - `WorkspaceKindSchema = z.enum(["work","personal"])` + type.
  - `WorkspaceSchema` (camelCase: id, name, kind, settings, createdAt) + `WorkspaceRowSchema` (snake_case).
- Güncelle:
  - `ProjectSchema` + `ProjectRowSchema`: `workspaceId` / `workspace_id` (uuid).
  - `JobSchema` + `JobRowSchema`: `workspaceId` / `workspace_id` (uuid).
  - `CreateJobSchema`: `workspaceId: z.string().uuid().optional()` (API doldurur).
  - `CreateProject` (varsa): `workspaceId` opsiyonel.
- `packages/core/src/index.ts` → yeni export'lar.
- Mapper'lar (`_mappers.ts` veya handoff): row↔domain dönüşümünde yeni alan.
- **Test:**
  - `packages/core/src/__tests__/types.test.ts`: `WorkspaceSchema` ve `WorkspaceRowSchema` valid/invalid parse; `ProjectSchema`/`JobSchema` `workspaceId` ile parse.
  - `pnpm --filter @conductor/core test` yeşil.
- **DoD:** Tipler derleniyor, testler yeşil.

### T-103 · Supabase generated types
- `apps/dashboard/lib/supabase/types.ts` regenerate (yeni `workspaces` tablosu + kolonlar) — veya elle workspace_id/workspaces ekle.
- **Test:** `pnpm --filter dashboard exec tsc --noEmit` hata vermez.
- **DoD:** Generated types yeni şemayı yansıtır.

---

## Faz 2 — API

### T-201 · Workspace helper — `apps/dashboard/lib/workspace.ts`
- `WORKSPACE_COOKIE = "active_workspace"`.
- Server util: `getActiveWorkspaceKind(): "work"|"personal"` (cookie'den `next/headers`, yoksa `personal`).
- Server util: `resolveWorkspaceId(supabase, kind): Promise<string>` (kind → workspaces.id).
- Client util: cookie get/set (`document.cookie`).
- Geçersiz/eksik cookie → `personal` fallback (asla throw).
- **Test:** `tests/api/workspace.test.ts` — cookie yok → personal; cookie='work' → work; geçersiz → personal.
- **DoD:** Helper test yeşil, throw etmiyor.

### T-202 · `GET /api/workspaces`
- Yeni route: `apps/dashboard/app/api/workspaces/route.ts`.
- Tüm workspace satırlarını döner (id, name, kind), `created_at` artan.
- **Test:** route testi — 2 satır (personal, work) döner; şekil doğru.
- **DoD:** Endpoint çalışır, test yeşil.

### T-203 · Projects route'ları workspace-aware
- `GET /api/projects` → aktif workspace_id filtre.
- `POST /api/projects` → aktif workspace_id yaz.
- **Test:** `tests/api/` — work cookie ile sadece work projeleri; personal default; POST aktif workspace yazıyor; cross-workspace sızıntı yok.
- **DoD:** Filtre sızdırmıyor, test yeşil.

### T-204 · Jobs route'ları workspace-aware
- `GET /api/jobs` → aktif workspace_id filtre.
- `POST /api/jobs` → aktif workspace_id yaz + **project workspace'i ile tutarlılık assert** (project başka workspace'teyse 400).
- **Test:** work cookie → sadece work job; POST workspace_id yazıyor; project-workspace uyumsuzluğu 400; cookie yok → personal.
- **DoD:** Filtre + assert çalışır, test yeşil.

### T-205 · Costs route workspace-aware
- `GET /api/costs` → aktif workspace_id filtre (usage_log → run → job.workspace_id, veya jobs.workspace_id üzerinden agregasyon).
- **Test:** work cookie → sadece work maliyeti; personal ayrı; toplam doğru.
- **DoD:** Cost agregasyonu workspace başına doğru, test yeşil.

### T-206 · Faz 2 regression
- **Test:** `pnpm --filter dashboard test` (API + mevcut) tümü yeşil; `tsc --noEmit` temiz.
- **DoD:** API katmanı tam yeşil, mevcut testler kırılmadı.

---

## Faz 3 — UI

### T-301 · WorkspaceSwitcher component
- `apps/dashboard/components/workspace-switcher.tsx`.
- Work/Personal toggle. `GET /api/workspaces`'ten liste (veya statik 2 kind).
- Seçim → cookie yaz (`lib/workspace.ts` client util) → `router.refresh()` (server component'ler yeni cookie ile re-fetch).
- Sidebar'da logo'nun altına, CTA butonlarının üstüne yerleştir ([sidebar.tsx](../../apps/dashboard/components/sidebar.tsx)).
- Aktif workspace görsel vurgulu (mevcut amber/sky tema dili).
- A11y: toggle erişilebilir (role, aria-pressed, klavye).
- **Test:** `tests/components/workspace-switcher.ui.test.tsx` — render, toggle tıklama cookie yazar, aktif state doğru.
- **DoD:** Component render + toggle + a11y test yeşil.

### T-302 · Sidebar entegrasyon
- `sidebar.tsx`'e `WorkspaceSwitcher` ekle (T-301 konumu).
- **Test:** sidebar render testi (varsa) güncel; e2e'de switcher görünür.
- **DoD:** Switcher sidebar'da, layout bozulmadı.

### T-303 · Liste sayfaları re-fetch
- Jobs / Projects / Costs client veya server component'leri workspace cookie değişince yeni veri çeker (`router.refresh()` server component'lerde otomatik; client fetch'ler cookie'yi okur).
- Realtime subscription'lar workspace değişince re-subscribe (eski workspace event sızmasın) — jobs realtime filter'ına workspace_id.
- **Test:** e2e `workspace-switch.spec.ts` — work'e geç → work job listesi; personal'a geç → personal listesi; karışma yok.
- **DoD:** Toggle listeyi değiştirir, realtime sızıntısı yok, e2e yeşil.

### T-304 · Yeni Feature / Yeni Fikir formları
- Job oluşturma akışı aktif workspace'i kullanır (API zaten cookie'den okur; form değişikliği minimal/sıfır olabilir — doğrula).
- **Test:** e2e — work'teyken job oluştur → work'te görünür; personal'da görünmez.
- **DoD:** Yeni job doğru workspace'e düşer, e2e yeşil.

### T-305 · Faz 3 regression
- **Test:** `pnpm --filter dashboard test && pnpm --filter dashboard test:e2e` (mevcut + yeni) yeşil; `pnpm lint` temiz.
- **DoD:** UI katmanı tam yeşil.

---

## Faz 4 — Worker

### T-401 · Worker log context
- `apps/worker/src/processJob.ts` (ve/veya `runner.ts`): job alırken `job.workspace_id` log satırına ekle (hangi workspace).
- Pipeline / lane / router DEĞİŞMEZ. Sadece gözlemlenebilirlik.
- **Test:** `apps/worker/src/__tests__/processJob.test.ts` — log'da workspace context görünür; mevcut pipeline davranışı değişmedi.
- **DoD:** workspace log'da, mevcut worker testleri yeşil.

### T-402 · Worker regression
- **Test:** `pnpm --filter worker test` (orchestrator, processJob, pipeline-integration, router) tümü yeşil.
- **DoD:** Worker tam yeşil, pipeline davranışı korundu.

---

## Faz 5 — Final

### T-501 · Tam suite + dokümantasyon
- `pnpm lint && pnpm test && pnpm test:e2e` kök seviye yeşil.
- `docs/04_CONTEXT_TRACKER.md`: karar günlüğüne workspace kararı satırı; sistem haritası güncel.
- (Opsiyonel) `docs/01_ARCHITECTURE.md` veri modeli güncellemesi.
- **Test:** tüm suite yeşil.
- **DoD:** Her şey yeşil, doc güncel.

### T-502 · Commit + PR
- Conventional Commits ile anlamlı commit(ler) (`feat(workspace): ...`).
- Push `feature/workspace-split`.
- PR aç (`.github/PULL_REQUEST_TEMPLATE.md`): ne değişti + neden + nasıl test edildi + (UI ekran görüntüsü). Migration içerdiği **işaretlenir** (insan onayı).
- **DUR.** Main'e merge YOK — insan kapısı.
- **DoD:** PR açık, açıklama dolu, migration işaretli, merge bekliyor.

---

## Bağımlılık grafiği
```
T-000
  └─ T-101 → T-102 → T-103          (DB/tipler, sıralı)
        └─ T-201 → T-202 → T-203 → T-204 → T-205 → T-206   (API)
              └─ T-301 → T-302 → T-303 → T-304 → T-305      (UI)
                    └─ T-401 → T-402                         (Worker)
                          └─ T-501 → T-502                   (Final)
```
Fazlar sıralı; faz içi bazı task'lar paralelleşebilir ama solo akışta sıralı git.
