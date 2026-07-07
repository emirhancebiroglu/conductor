# CLAUDE.md — Conductor

Bu dosya, bu repoda çalışan tüm AI agent'larının (Claude Code, OpenCode) okuduğu kök kurallar dosyasıdır. Kısa, kesin ve güncel tut. Bir kural eskirse **sil**, biriktirme.

---

## Proje nedir
Conductor iki ayrı pipeline barındırır:
1. **Feature pipeline**: kullanıcı bir GitHub projesi seçip kısa bir feature açıklaması girer; agent ekibi planlar, kodlar, test eder ve **insan onayı için bir PR açar**. Main'e merge'ü her zaman insan yapar.
2. **CM pipeline** (`apps/cm-worker`): Checkmarx taramasından çıkan CRITICAL/HIGH bulguları otomatik fikslemeye çalışır. **PR açmaz** — bot-owned `checkmarx-auto` branch'ine commit+push yapıp rescan ile doğrular, `verified` (temiz) veya `needs_human` (insan incelemesi gerekli) durumunda durur. PR/merge, branch'i inceleyen insanın işidir, pipeline'ın değil.

## Mutlak kurallar (ihlal etme)
- **MAIN'E ASLA OTOMATİK MERGE ETME.** Feature pipeline sadece feature branch'e commit/push ve PR açar. CM pipeline sadece `checkmarx-auto`'ya commit/push yapar, PR bile açmaz. Merge insan kapısıdır.
- **`--dangerously-skip-permissions` veya benzeri "her şeyi onayla" bayraklarını prod repolarda kullanma.**
- **Sırları (secrets) asla commit'leme, loglama veya çıktıya yazma.** `.env`, token, API key → daima git-ignore.
- **Migration / şema değişikliği / `DROP` / `DELETE` içeren DB işlemleri** her zaman ayrı işaretlenir ve insan onayı ister.
- **Üretime (prod) deploy etme.** Conductor PR'a kadar gider; deploy ayrı, insan tetikli.
- Bir görevin kapsamı belirsizse **dur ve netleştir**, varsayımla devam etme.

## İş akışı — feature pipeline
1. **product-owner** skill'i: kısa açıklamayı al, web araştırması ile detaylı spec + kabul kriterleri üret.
2. **architect** skill'i: teknik analiz, plan, görev kırılımı, `feature/<slug>` branch'i aç.
3. **frontend** + **backend** skill'leri: koordineli implementasyon (paylaşılan API kontratı üzerinden).
4. **code-reviewer** skill'i: incele → sorunları yazan agent'a geri gönder → **temiz olana kadar döngü**.
5. **tester** skill'i: unit + edge case + logging/exception → uygulamayı ayağa kaldır → Playwright E2E → **pass olana kadar döngü** → anlamlı commit mesajıyla commit → push → **PR aç ve dur**.

Detaylı roller: `docs/05_AGENT_TEAM.md`. Skill'ler: `skills/<rol>/SKILL.md`.

## İş akışı — CM pipeline (`apps/cm-worker`)
1. **scan**: Checkmarx taraması (CLI, ScaResolver ile — Maven/Gradle transitive bağımlılık kapsaması için gerekli), sonuçlar CRITICAL/HIGH'a filtrelenip `cm_finding`'e yazılır.
2. **plan**: `cm-fix-planner` her bulgu için strateji seçer (upgrade/mitigate/code-fix/skip/needs-human) — gerçek bir fix yolu varsa asla `needs-human`'a düşmemeli.
3. **fix**: `cm-sca-agent`/`cm-sast-agent` bulguları düzeltir, `checkmarx-auto` branch'ine commit+push yapar (force-push — bot-owned branch, retry'lar arası state korunur).
4. **verify + rescan**: build/test deterministik çalıştırılır (LLM'e güvenilmez); `checkmarx-auto`'nun taze rescan'i alınır (CLI submit + REST `/api/results` okuma), sonuç `cm_finding`'e fingerprint bazlı senkronize edilir (hâlâ CRITICAL/HIGH olanlar `open`, artık raporlanmayanlar `fixed`).
5. **CRITICAL/HIGH sayısı sıfır değilse** → retry (`plan`'a geri döner, `max_fix_attempts`'e kadar). Sıfırsa → **`verified`** (terminal, PR açılmaz) ve rapor üretilir. Retry'lar tükenirse → **`needs_human`**.

`verified`/`needs_human`/`done`/`failed`/`scan_failed` = terminal durumlar (bkz. `packages/cm-core/src/scan-states.ts`). PR açma adımı **yok** — `checkmarx-auto` branch'ini incelemek ve PR açmak insan işidir.

## Komutlar (bu repo)
> Bunları gerçek repoya göre güncelle. Placeholder.
```bash
pnpm install          # bağımlılıklar
pnpm dev              # dashboard'u lokal çalıştır
pnpm build            # prod build
pnpm test             # unit testler (vitest)
pnpm test:e2e         # Playwright E2E
pnpm lint             # eslint + tsc --noEmit
pnpm db:push          # supabase şema push
```
**Her PR öncesi:** `pnpm lint && pnpm test && pnpm test:e2e` yeşil olmalı.

## Kod standartları
- Dil: TypeScript, `strict: true`. `any` yasak; gerekçesi varsa `// why:` yorumu ile.
- Stil: ESLint + Prettier; tartışma yok, formatter ne derse o.
- Commit: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`).
- Branch: `feature/<kısa-slug>`, `fix/<slug>`. Asla doğrudan `main`.
- PR: ne değişti + neden + nasıl test edildi + ekran görüntüsü (UI ise). Şablon: `.github/PULL_REQUEST_TEMPLATE.md`.
- FE: 2026 UI/UX standartları, erişilebilirlik (a11y) zorunlu. Detay: `skills/frontend/SKILL.md`.
- BE: her endpoint'te input validation (zod), yapılandırılmış hata yanıtı, log + metrik.

## Şerit (model) seçimi
- **Ucuz şerit (OpenCode Go):** grep/arama, boilerplate, ilk taslak, basit unit test, dosya gezme.
- **Premium şerit (Claude Code / Pro):** mimari karar, karmaşık debug, final code review, güvenlik-hassas kod.
- Şüphedeysen ucuzla başla, takılırsan premium'a yükselt. Policy: `docs/08_COST_AND_LIMITS.md`.

## Bağlam yönetimi
- Uzun işlerde context'i şişirme. Her agent kendi dar görevine odaklanır.
- Kalıcı kararlar `docs/04_CONTEXT_TRACKER.md`'ye yazılır; sohbet geçmişine güvenme.
- Repo geneli bilgi için önce `docs/` oku, sonra kodu tara.

## Yasaklı / dikkat
- Telif: lisanssız kod/içerik kopyalama yok.
- Kişisel veri / müşteri verisi loglama yok.
- Üçüncü parti API ToS'una aykırı otomasyon (örn. izinsiz scraping, otomatik sosyal post) yok — bu projede sosyal paylaşım **üret + kuyruğa al, insan onaylar**.

## Definition of Done (bir feature için)
- [ ] Kabul kriterleri karşılandı
- [ ] `lint + test + e2e` yeşil
- [ ] Yeni kod için testler var
- [ ] Loglama + hata yönetimi mevcut
- [ ] PR açıldı, açıklama dolu
- [ ] (İnsan) PR incelendi ve merge edildi
