# 04 — Context Tracker

> **Bu dosya canlıdır.** Agent'lar ve sen, "nerede kaldık" sorusunun cevabını buradan okur — sohbet geçmişine güvenme. Her oturum başı oku, her oturum sonu güncelle. Eskiyen satırı sil.

## Şu an
- Workspace split (work/personal) — T-502 PR bekliyor
- Son milestone: M4 ✅

## 📌 Bu hafta (Pazartesi'de doldur)
- [ ] …
- [ ] …

---

## 🧭 Karar günlüğü (ADR-lite)
> Önemli her teknik karar: tarih, karar, gerekçe, alternatif. Karar değişirse yeni satır ekle, eskiyi "ÜZERİNE YAZILDI" işaretle.

| Tarih | Karar | Gerekçe | Reddedilen alternatif |
|-------|-------|---------|------------------------|
| 2026-05-30 | İki düzlem: serverless dashboard + uzun ömürlü worker | Agent CLI'ları repo+shell ister | Tek serverless app |
| 2026-05-30 | Kuyruk v1 = Supabase tablo poll/Realtime | Sıfır ekstra altyapı | BullMQ+Redis (ölçekte) |
| 2026-05-30 | Ucuz şerit OpenCode Go, premium Claude Code | Sabit maliyet + en iyi kodlama | Tek model her şeye |
| 2026-05-30 | Main'e otomatik merge YOK | En kötü hata senaryosunu kapatır | Tam otonom merge |
| 2026-06-03 | Workspace ayrımı: `workspaces` tablosu + `workspace_id` FK | Bağlam izolasyonu (work/personal); N-workspace genişler; per-workspace ayar (settings jsonb) | `scope enum` (2'ye kilitler), ayrı Supabase projesi (aşırı) |

---

## ❓ Açık sorular (cevaplanınca karar günlüğüne taşı)
- [ ] Worker'ı nerede host edeceğiz? (Fly.io vs Railway vs kendi VPS) — maliyet/kolaylık karşılaştır.
- [ ] GitHub App mı fine-grained PAT mı? (App webhook + çoklu repo için daha iyi; PAT solo v1 için yeter.)
- [ ] Reviewer/tester döngüsü max kaç tur? (öneri: 3, sonra `needs_human`.)
- [ ] Ucuz şeritte hangi model varsayılan? (`opencode models` ile güncel listeyi doğrula.)

---

## 🔑 Ortam / erişim (sırrı BURAYA yazma — sadece "nerede" notu)
- GitHub: App/PAT → secret store: `____`
- Supabase: proje URL `____`, anon key dashboard env'de, service key worker env'de
- OpenCode Go: API key → worker env `OPENCODE_GO_KEY`
- Claude Code: Pro login (oturum), `claude /login`
- Model adları: `____` (config'te, koda gömülü değil)

---

## 🗺️ Sistem haritası (hızlı hatırlatma)
```
dashboard (Next/Vercel) ─Supabase─ worker (VM)
workspaces(work|personal) → projects → jobs → runs
worker: clone→branch→ PO→Arch→FE+BE→Reviewer⟲→Tester⟲ →commit→push→PR
insan kapısı: merge, migration, belirsizlik, limit, dış paylaşım
```

---

## 📖 Sözlük (proje jargonu)
- **Şerit (lane):** ucuz (OpenCode Go) vs premium (Claude Code) model yolu.
- **Job:** bir feature veya idea isteği (1 job = 1 PR hedefi).
- **Run:** bir agent adımının tek çalışması (loglanır).
- **Handoff:** bir agent'ın çıktısının sonraki agent'a yapılandırılmış girdi olması.
- **İnsan kapısı (human gate):** worker'ın durup senin onayını beklediği nokta.
- **Döngü (⟲):** reviewer/tester'ın "tamam" diyene kadar tekrarlaması.
- **Dogfood:** sistemi önce kendi projende kullanmak.

---

## 🧹 Temizlik kuralı
Bu dosya 1 ekranı geçmesin. Biten görevler `03`'te işaretli; burada sadece **şu an + kararlar + açık sorular** kalsın. Geçmişi şişirme.
