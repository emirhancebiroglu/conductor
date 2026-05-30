# 00 — Master Plan (A → Z)

> **Hedef:** Senaryo 1 (feature pipeline) dashboard'unu kendi projende çalışır hale getirmek; ardından fikir→MVP hattını eklemek. Mottо: maksimum otomasyon, minimum maliyet, maksimum zaman tasarrufu.

## Varsayımlar (değiştir ve plan otomatik kayar)
- **Çalışma temposu:** solo, ~12 saat/hafta (akşamlar + hafta sonu).
- **Başlangıç:** Pazartesi **2026-06-01**.
- **MVP hedefi (feature pipeline çalışır):** ~8 hafta → **2026-07-27 haftası**.
- Tam zamanlı çalışırsan (~40 sa/hafta) bu takvim ~3 haftaya iner. Süreleri saat cinsinden verdim; haftaya kendin böl.

## Kuzey yıldızı metrikleri (başarı neye benziyor)
1. **Time-to-PR:** "feature'ı yaz" → "incelemeye hazır PR" < 30 dk (iyi tanımlı feature için).
2. **PR kabul oranı:** açılan PR'ların %70+'ı küçük düzeltmeyle merge edilebilir.
3. **Maliyet:** aylık değişken model maliyeti < $30 hedef, < $75 tavan (bkz. doc 08).
4. **Senin emeğin:** bir feature'a aktif insan zamanı < 15 dk (açıklama + PR review).

---

## Faz haritası

| Faz | Ne | Süre | Bitiş (hedef) | Çıktı |
|-----|----|------|---------------|-------|
| 0 | Foundations | ~8 sa | 2026-06-07 | Hesaplar, env, repo iskeleti, "hello agent" |
| 1 | Control plane MVP | ~24 sa | 2026-06-21 | Dashboard + GitHub bağla + proje seç + feature formu + DB |
| 2 | Execution plane (happy path) | ~20 sa | 2026-06-28 | Worker: branch→tek agent→commit→push→PR |
| 3 | Agent ekibi | ~28 sa | 2026-07-12 | PO→Architect→FE+BE→Reviewer loop→Tester loop |
| 4 | Cost router + observability + kapılar | ~16 sa | 2026-07-19 | Şerit yönlendirme, usage log, onay kapıları UI |
| 5 | Fikir→MVP hattı | ~16 sa | 2026-07-26 | Research→spec→scaffold→feature pipeline'a devir |
| 6 | Hardening + dogfood | ~12 sa | 2026-08-02 | Gerçek feature'da kullan, retro, dökümante et |

> İşaretleme ve görev detayı: `docs/03_TASK_TRACKER.md`.

---

## Faz 0 — Foundations (Hafta 1)
**Amaç:** Tek bir agent'ın tek bir repoda branch açıp commit'leyip PR açabildiğini kanıtlamak. Dashboard yok, sadece boru hattının kalbi.

- Hesaplar/erişim: GitHub (App veya fine-grained PAT), Supabase projesi, OpenCode Go anahtarı, Claude Code (Pro) login.
- Worker VM (Fly.io/Railway/küçük VPS) — Node 22+, git, OpenCode CLI, Claude Code CLI, Playwright kurulu.
- "Hello agent" scripti: bir repoyu klonla → `feature/hello` aç → README'ye satır ekle → commit → push → PR aç (Octokit).
- **Milestone M0:** Elle tetiklenen script gerçek bir PR açıyor. ✅ ise Faz 1.

## Faz 1 — Control plane MVP (Hafta 2-3)
**Amaç:** Dashboard'dan GitHub'a bağlanıp proje seçip feature açıklaması girmek; bu bir `job` kaydı oluştursun.

- Next.js + Supabase iskeleti, auth (sadece sen).
- GitHub OAuth/App bağlantısı → repo listesini çek → proje seç.
- "New feature" formu: başlık + kısa açıklama + hedef branch + şerit tercihi (auto/cheap/premium).
- `jobs`, `projects`, `runs` tabloları (şema doc 01'de).
- Supabase Realtime ile job durumunu canlı göster.
- **Milestone M1:** Dashboard'dan feature gönderince DB'de `job` oluşuyor ve listede "queued" görünüyor.

## Faz 2 — Execution plane / happy path (Hafta 3-4)
**Amaç:** Worker bir `queued` job'u alıp **tek** agent'la uçtan uca PR açsın (henüz ekip yok).

- Worker job poll/subscribe → repoyu worktree'ye klonla → branch aç.
- Tek agent (Claude Code headless `claude -p` veya OpenCode run) feature'ı uygula.
- Commit + push + PR aç; job durumunu `pr_opened`'a çek, PR linkini dashboard'a yaz.
- Hata yakalama: fail olursa `failed` + log.
- **Milestone M2:** Dashboard'dan basit bir feature → ~dakikalar içinde gerçek PR + linki ekranda.

## Faz 3 — Agent ekibi (Hafta 4-6)
**Amaç:** Tek agent yerine roller ve handoff + iki kalite döngüsü.

- Roller: product-owner, architect, frontend, backend, code-reviewer, tester (skills/ altında).
- Handoff protokolü: her agent yapılandırılmış çıktı üretir (sonraki agent'ın girdisi). Bkz. doc 05.
- **Reviewer döngüsü:** reviewer "temiz" diyene kadar yazan agent'a geri gönder (max N tur, sonra insana yükselt).
- **Tester döngüsü:** unit + Playwright E2E pass olana kadar (max N tur).
- Şerit ataması: ucuz/premium (CLAUDE.md + doc 08).
- **Milestone M3:** Orta zorlukta bir feature, ekip tarafından planlanıp kodlanıp test edilip PR'a dönüşüyor.

## Faz 4 — Router + observability + kapılar (Hafta 6-7)
- Cost router: göreve göre şerit/model seç; limit yaklaşınca ucuza düş (doc 08).
- `usage_log`: her agent çağrısının model + token + tahmini maliyeti.
- Dashboard panelleri: çalışan run'lar, adım adım log, maliyet sayacı, limit barı.
- İnsan kapıları UI: PR review linki, "tehlikeli işlem" (migration vb.) onay butonu.
- **Milestone M4:** Bir bakışta "ne çalışıyor, ne kadara mal oldu, neyi onaylamam lazım" görünüyor.

## Faz 5 — Fikir→MVP hattı (Hafta 7-8)
- Yeni job tipi: `idea`. Girdi: bir cümlelik ürün fikri.
- Research agent'ları: pazar/rakip/pain araştırması (web + Product Hunt + Reddit), PRD taslağı, MVP kapsamı, tech seçim.
- Çıktı: bir repo scaffold + ilk feature listesi → **feature pipeline'a otomatik devir**.
- Detay: `docs/09_PRODUCT_IDEA_TO_MVP.md`.
- **Milestone M5:** Bir fikir cümlesi → araştırma raporu + scaffold repo + sıraya alınmış ilk feature'lar.

## Faz 6 — Hardening + dogfood (Hafta 8+)
- Gerçek bir kendi projende 1 hafta günlük kullan; kırılan her şeyi `docs/04` ve `docs/10`'a yaz.
- Retry/timeout/kill-switch sağlamlaştır.
- Retro: neyi otomatikleştirdik, nerede hâlâ elle müdahale var, sıradaki senaryo (marketing / iş akışı) hangisi?

---

## Sıradaki senaryolar (MVP sonrası, ayrı projeler)
Bunlar **bilerek kapsam dışı** tutuluyor; biri sağlam çalışınca sıradakini onun kazancıyla finanse et.
- Marketing/distribution (üret + kuyruğa al, insan post eder).
- İş akışı (mail/Teams triyajı, toplantı notu→görev).
- Bunların hepsi aynı `jobs` + worker + dashboard altyapısını yeniden kullanır.

## Çalışma ritmi
- **Pazartesi:** haftanın görevlerini `03_TASK_TRACKER.md`'den seç, `04_CONTEXT_TRACKER.md`'ye "bu hafta" yaz.
- **Her gün:** 1 görev bitir, context tracker'ı güncelle.
- **Cuma:** demo + retro; deadline kaymışsa nedenini yaz (saat tahminini düzelt, kapsamı değil).
