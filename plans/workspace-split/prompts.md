# Prompts — Work/Personal Workspace Split

> **Plan:** [plan.md](./plan.md) · **Tasks:** [tasks.md](./tasks.md)
> Her task için kopyala-yapıştır agent promptu. Sırayla çalıştır. Her promptun sonunda **test** zorunlu; yeşil olmadan sonrakine geçme.
> **Mutlak kurallar (her promptta geçerli):** Main'e otomatik merge YOK. Sırları loglama/commitleme. Migration insan onayı ister. Belirsizlikte dur, netleştir. TypeScript strict, `any` yasak.

---

## T-000 — Branch

```
`feature/workspace-split` adında bir git branch aç (main'den veya mevcut feature/cm-pipeline'dan — hangisi güncelse). Working tree'nin temiz olduğunu doğrula. Sadece branch aç, başka değişiklik yapma. `git branch --show-current` çıktısını göster.
```

---

## T-101 — Migration

```
`apps/dashboard/supabase/migrations/007_workspaces.sql` migration dosyasını oluştur. Mevcut `001_initial_schema.sql` stilini ve RLS pattern'ini birebir takip et (service-role full-access policy).

Sıra KESİNLİKLE şöyle olmalı (boş tabloda FK fail olmasın):
1. workspaces tablosu: id uuid pk default gen_random_uuid(), name text not null, kind text not null, settings jsonb default '{}', created_at timestamptz default now().
2. workspaces için RLS enable + "service role full access" policy.
3. Seed: ('Personal','personal') ve ('Work','work') iki satır.
4. projects'e workspace_id uuid kolonu ekle (önce nullable).
5. Backfill: tüm projects.workspace_id = personal workspace'in id'si.
6. projects.workspace_id NOT NULL yap + FK references workspaces(id).
7. jobs'a workspace_id uuid kolonu ekle (nullable).
8. Backfill: jobs.workspace_id = ilgili project'in workspace_id'si (project_id join).
9. jobs.workspace_id NOT NULL yap + FK.
10. Index: projects(workspace_id) ve jobs(workspace_id, status).

Dosya başına rollback notunu yorum olarak ekle.

TEST: Migration'ı lokal Supabase'e (veya hedef projeye) uygula. Şunları doğrula ve çıktılarını göster:
- select count(*) from workspaces  → 2
- select count(*) from projects where workspace_id is null  → 0
- select count(*) from jobs where workspace_id is null  → 0
Migration salt-ekleme; yıkıcı işlem yok. Migration içerdiği için bunu PR'da insan onayı gerektiren değişiklik olarak not edeceğiz.
```

---

## T-102 — Core tipler

```
`packages/core/src/types.ts` dosyasını workspace için genişlet. Mevcut zod + camelCase/snake_case (Row) ikili pattern'ini birebir takip et.

Ekle:
- WorkspaceKindSchema = z.enum(["work","personal"]) + WorkspaceKind type.
- WorkspaceSchema (id uuid, name, kind: WorkspaceKindSchema, settings: z.record(z.unknown()), createdAt datetime) + Workspace type.
- WorkspaceRowSchema (snake_case karşılığı: created_at) + WorkspaceRow type.

Güncelle:
- ProjectSchema + ProjectRowSchema → workspaceId / workspace_id (z.string().uuid()).
- JobSchema + JobRowSchema → workspaceId / workspace_id (z.string().uuid()).
- CreateJobSchema → workspaceId: z.string().uuid().optional()  (API aktif workspace'ten dolduracak).
- Varsa CreateProject şeması → workspaceId opsiyonel.

`packages/core/src/index.ts` → yeni schema/type export'larını ekle.
Row↔domain mapper'larını (varsa `apps/dashboard/app/api/agents/_mappers.ts` veya core içindeki dönüşümler) yeni alanı taşıyacak şekilde güncelle.

TEST: `packages/core/src/__tests__/types.test.ts`'e ekle:
- WorkspaceSchema valid bir obje parse eder; invalid kind reddedilir.
- WorkspaceRowSchema snake_case parse eder.
- ProjectSchema ve JobSchema workspaceId alanı ile parse eder; eksikse hata.
Çalıştır: pnpm --filter @conductor/core test  → yeşil olmalı.
```

---

## T-103 — Generated Supabase types

```
`apps/dashboard/lib/supabase/types.ts` dosyasını yeni şemaya göre güncelle: workspaces tablosu (Row/Insert/Update) + projects ve jobs tablolarına workspace_id kolonu. Mümkünse Supabase type generator kullan; değilse mevcut tabloların stilini taklit ederek elle ekle.

TEST: pnpm --filter dashboard exec tsc --noEmit  → hata vermemeli.
```

---

## T-201 — Workspace helper

```
`apps/dashboard/lib/workspace.ts` oluştur:
- export const WORKSPACE_COOKIE = "active_workspace".
- Server: getActiveWorkspaceKind(): "work"|"personal" — next/headers cookies()'ten WORKSPACE_COOKIE oku; yoksa/geçersizse "personal" döndür (asla throw).
- Server: resolveWorkspaceId(supabase, kind): Promise<string> — workspaces tablosundan kind'e karşılık id getir.
- Client: getWorkspaceCookie() / setWorkspaceCookie(kind) — document.cookie ile (path=/, uygun max-age).

Geçersiz değer → "personal" fallback. Hiçbir durumda throw etme.

TEST: `apps/dashboard/tests/api/workspace.test.ts` — cookie yok → "personal"; cookie="work" → "work"; cookie="garbage" → "personal". resolveWorkspaceId doğru id döner (mock supabase).
Çalıştır: pnpm --filter dashboard test workspace  → yeşil.
```

---

## T-202 — GET /api/workspaces

```
`apps/dashboard/app/api/workspaces/route.ts` oluştur. GET: tüm workspace satırlarını (id, name, kind) created_at artan sırayla döner. Mevcut route'lardaki supabase server client + hata yanıtı (zod yapılandırılmış) pattern'ini kullan.

TEST: route testi — 2 satır döner (personal, work); her satır id/name/kind içerir; şekil zod ile doğrulanır.
Çalıştır: pnpm --filter dashboard test  → yeşil.
```

---

## T-203 — Projects route'ları

```
`apps/dashboard/app/api/projects/route.ts` (ve gerekiyorsa `[id]/route.ts`):
- GET: getActiveWorkspaceKind → resolveWorkspaceId → projects'i workspace_id ile filtrele.
- POST: yeni project'e aktif workspace_id'yi yaz.
Cookie yoksa personal'a düş, 500 atma.

TEST: `apps/dashboard/tests/api/` — work cookie ile sadece work projeleri döner; personal default; cross-workspace sızıntı yok (work project'i personal filtresinde görünmez); POST aktif workspace yazıyor.
Çalıştır: pnpm --filter dashboard test  → yeşil.
```

---

## T-204 — Jobs route'ları

```
`apps/dashboard/app/api/jobs/route.ts`:
- GET: aktif workspace_id ile filtrele.
- POST: aktif workspace_id'yi job'a yaz. AYRICA: job'ın project_id'sinin workspace'i aktif workspace ile eşleşmeli — eşleşmezse 400 (yapılandırılmış hata). Bu, work job'ının personal repoya açılmasını engeller.
Cookie yoksa personal.

TEST: work cookie → sadece work job; POST workspace_id yazıyor; project başka workspace'teyse 400; cookie yok → personal default.
Çalıştır: pnpm --filter dashboard test  → yeşil.
```

---

## T-205 — Costs route

```
`apps/dashboard/app/api/costs/route.ts`: maliyet agregasyonunu aktif workspace ile filtrele. usage_log → runs → jobs.workspace_id zinciri (veya jobs.workspace_id üzerinden join). Sadece aktif workspace'in maliyeti dönsün.

TEST: work cookie → sadece work maliyeti; personal ayrı toplam; iki workspace toplamı karışmıyor.
Çalıştır: pnpm --filter dashboard test  → yeşil.
```

---

## T-206 — Faz 2 regression

```
API katmanı tamamlandı. Tam dashboard test + tip kontrolü çalıştır:
- pnpm --filter dashboard test
- pnpm --filter dashboard exec tsc --noEmit
Mevcut testlerin hiçbiri kırılmamalı. Kırık varsa düzelt, sonra raporla.
```

---

## T-301 — WorkspaceSwitcher

```
`apps/dashboard/components/workspace-switcher.tsx` oluştur — client component.
- Work/Personal toggle (statik 2 kind yeterli; istersen GET /api/workspaces'ten besle).
- Aktif kind cookie'den okunur (lib/workspace.ts client util).
- Seçim değişince: setWorkspaceCookie(kind) → router.refresh() (server component'ler yeni cookie ile re-fetch etsin).
- Görsel: mevcut sidebar tema dili (amber/sky, Syne font, uppercase tracking). Aktif workspace vurgulu.
- A11y ZORUNLU: role="group"/toggle butonları, aria-pressed, klavye ile seçilebilir, focus görünür.

TEST: `apps/dashboard/tests/components/workspace-switcher.ui.test.tsx` — render; toggle tıklayınca cookie set edilir; aktif state doğru görünür; aria-pressed doğru.
Çalıştır: pnpm --filter dashboard test workspace-switcher  → yeşil.
```

---

## T-302 — Sidebar entegrasyon

```
`apps/dashboard/components/sidebar.tsx`'e WorkspaceSwitcher ekle: logo bloğunun ALTINA, "CTA buttons" (NEW FEATURE / YENİ FİKİR) bloğunun ÜSTÜNE. Mevcut spacing/border stiliyle uyumlu. Layout bozulmamalı.

TEST: e2e veya görsel kontrol — switcher sidebar'da görünür, butonlar/nav bozulmadı. Varsa sidebar render testi güncelle.
Çalıştır: pnpm --filter dashboard test  → yeşil.
```

---

## T-303 — Liste sayfaları re-fetch + realtime

```
Jobs / Projects / Costs sayfalarının workspace cookie değişince doğru veriyi göstermesini sağla:
- Server component'ler router.refresh() ile otomatik re-fetch eder (API zaten cookie okuyor).
- Client-side realtime subscription'lar (jobs listesi, worker-status hariç) workspace değişince re-subscribe etmeli; eski workspace event'i sızmamalı. Jobs realtime filter'ına workspace_id ekle.

TEST: `apps/dashboard/e2e/workspace-switch.spec.ts` oluştur:
- Personal'da X job görünür, work'e geç → work job'ları görünür, personal job'ları görünmez.
- Tersi de doğru. Realtime event yanlış workspace'e sızmıyor.
Çalıştır: pnpm --filter dashboard test:e2e workspace-switch  → yeşil.
```

---

## T-304 — Job oluşturma formları

```
"Yeni Feature" ve "Yeni Fikir" akışlarının aktif workspace'e job oluşturduğunu doğrula. API POST /api/jobs zaten cookie'den workspace okuyor; form tarafında ekstra değişiklik gerekiyorsa (örn. workspace_id'yi gövdeye koymak yerine cookie'ye güvenmek) minimal düzelt.

TEST: e2e — work'teyken yeni job oluştur → work listesinde görünür, personal'da görünmez.
Çalıştır: pnpm --filter dashboard test:e2e  → yeşil.
```

---

## T-305 — Faz 3 regression

```
UI katmanı tamamlandı. Çalıştır:
- pnpm --filter dashboard test
- pnpm --filter dashboard test:e2e
- pnpm lint
Hepsi yeşil olmalı. Mevcut e2e/unit kırılmamalı. Kırık varsa düzelt, raporla.
```

---

## T-401 — Worker log context

```
`apps/worker/src/processJob.ts` (ve gerekirse `runner.ts`): worker bir job işlemeye başladığında log'a workspace context'ini ekle (job.workspace_id). Pipeline mantığı, lane seçimi, router DEĞİŞMEYECEK — sadece gözlemlenebilirlik için log.

TEST: `apps/worker/src/__tests__/processJob.test.ts` — log çıktısında workspace bilgisi görünür; mevcut pipeline davranışı (agent sırası, status geçişleri) değişmedi.
Çalıştır: pnpm --filter worker test processJob  → yeşil.
```

---

## T-402 — Worker regression

```
Worker testlerinin tamamını çalıştır:
- pnpm --filter worker test
orchestrator, processJob, pipeline-integration, router, agentConfig — hepsi yeşil olmalı. Pipeline davranışı korunmalı.
```

---

## T-501 — Final suite + doc

```
Tam test suite'i çalıştır: pnpm lint && pnpm test && pnpm test:e2e — kök seviye yeşil olmalı.

docs/04_CONTEXT_TRACKER.md güncelle:
- Karar günlüğüne satır: "2026-06-02 | Workspace ayrımı (work/personal), tek DB + workspace_id | Bağlam izolasyonu, future N-workspace | Ayrı Supabase projesi (aşırı)".
- Sistem haritası workspace'i yansıtsın.
(Opsiyonel) docs/01_ARCHITECTURE.md veri modeline workspaces ekle.

TEST: tüm suite yeşil; doc tutarlı.
```

---

## T-502 — Commit + PR

```
Conventional Commits ile anlamlı commit(ler) yap (örn. feat(workspace): add work/personal workspace split). Co-Authored-By satırını ekle.
feature/workspace-split branch'ini push et.
PR aç (.github/PULL_REQUEST_TEMPLATE.md): ne değişti + neden + nasıl test edildi + UI ekran görüntüsü. Migration içerdiğini AÇIKÇA işaretle (insan onayı gereken değişiklik).

DUR. Main'e merge YOK — merge insan kapısı. PR'ı açtıktan sonra başka işlem yapma, raporla.
```

---

## Notlar (tüm agent'lar için)
- Belirsizlik → dur, netleştir. Varsayımla devam etme.
- Cookie yokken her katman `personal`'a düşer, asla 500/throw.
- Cross-workspace sızıntı app-katmanında engellenir; her filtre testinde sızıntı kontrolü yap.
- Agent havuzu (agent_config/categories/provider_models) workspace-agnostik — dokunma.
- Lane/model `agent_config`'te yönetiliyor — workspace lane'e dokunmaz.
