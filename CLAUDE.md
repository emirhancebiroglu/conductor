# CLAUDE.md — Conductor

Bu dosya, bu repoda çalışan tüm AI agent'larının (Claude Code, OpenCode) okuduğu kök kurallar dosyasıdır. Kısa, kesin ve güncel tut. Bir kural eskirse **sil**, biriktirme.

---

## Proje nedir
Conductor: bir kontrol dashboard'u + agent worker. Kullanıcı bir GitHub projesi seçip kısa bir feature açıklaması girer; agent ekibi planlar, kodlar, test eder ve **insan onayı için bir PR açar**. Main'e merge'ü her zaman insan yapar.

## Mutlak kurallar (ihlal etme)
- **MAIN'E ASLA OTOMATİK MERGE ETME.** Sadece feature branch'e commit/push ve PR aç. Merge insan kapısıdır.
- **`--dangerously-skip-permissions` veya benzeri "her şeyi onayla" bayraklarını prod repolarda kullanma.**
- **Sırları (secrets) asla commit'leme, loglama veya çıktıya yazma.** `.env`, token, API key → daima git-ignore.
- **Migration / şema değişikliği / `DROP` / `DELETE` içeren DB işlemleri** her zaman ayrı işaretlenir ve insan onayı ister.
- **Üretime (prod) deploy etme.** Conductor PR'a kadar gider; deploy ayrı, insan tetikli.
- Bir görevin kapsamı belirsizse **dur ve netleştir**, varsayımla devam etme.

## İş akışı (feature pipeline)
1. **product-owner** skill'i: kısa açıklamayı al, web araştırması ile detaylı spec + kabul kriterleri üret.
2. **architect** skill'i: teknik analiz, plan, görev kırılımı, `feature/<slug>` branch'i aç.
3. **frontend** + **backend** skill'leri: koordineli implementasyon (paylaşılan API kontratı üzerinden).
4. **code-reviewer** skill'i: incele → sorunları yazan agent'a geri gönder → **temiz olana kadar döngü**.
5. **tester** skill'i: unit + edge case + logging/exception → uygulamayı ayağa kaldır → Playwright E2E → **pass olana kadar döngü** → anlamlı commit mesajıyla commit → push → **PR aç ve dur**.

Detaylı roller: `docs/05_AGENT_TEAM.md`. Skill'ler: `skills/<rol>/SKILL.md`.

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
