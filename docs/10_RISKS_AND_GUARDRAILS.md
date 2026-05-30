# 10 — Risks & Guardrails

> Otonom agent sistemlerinde asıl tehlike "kötü kod" değil; **gözetimsiz çarpışan hatalar**, **maliyet patlaması** ve **bakım yükünün seni boğması**. Aşağıdaki kapılar bunların her birine karşı.

## Risk matrisi

| Risk | Olasılık | Etki | Guardrail |
|------|----------|------|-----------|
| Çarpışan hata (zincir uzun) | Yüksek | Yüksek | Dar kapsam, max 3 döngü, handoff şeması, `needs_human` |
| Main'e kötü kod gitmesi | Orta | Çok yüksek | **Otomatik merge YOK** — insan merge kapısı |
| Maliyet/limit patlaması | Orta | Orta | usage_log + soft eşik + kill-switch (doc 08) |
| Sonsuz döngü | Orta | Orta | Reviewer/tester max 3 tur → insana yükselt |
| Sır sızıntısı | Düşük | Çok yüksek | Secret'lar env'de, git-ignore, loglarda maskeleme |
| Yıkıcı DB işlemi | Düşük | Çok yüksek | `approvals` kapısı (migration/DROP/DELETE insan onayı) |
| Bakım yükü > tasarruf | Yüksek | Yüksek | Tek senaryo önce, yüzeyi dar tut, kullanılmayanı sil |
| Belirsiz gereksinim → çöp çıktı | Yüksek | Orta | PO detaylandırma + `open_questions` → `needs_human` |
| GitHub agent rate-limit (2026) | Orta | Orta | İş aralıkla, retry+backoff, gereksiz push'tan kaçın |
| Üçüncü parti ToS ihlali (sosyal) | — | Yüksek | Sosyal otomasyon YOK; "üret+onay kuyruğu" |

## Sert kurallar (kod seviyesinde zorla)
1. **`main`'e doğrudan push/merge engellensin** (branch protection + worker yetkisi yok).
2. **`approvals` pending iken** ilgili yıkıcı işlem **çalıştırılamaz**.
3. **Soft limit aşılınca** premium kapatılır; tavan yaklaşınca yeni job kabulü durur.
4. **Her run timeout'lu** (örn. 15 dk); aşarsa `failed`, worktree temizlenir.
5. **Her agent çıktısı zod ile doğrulanır**; şema bozuksa 1 retry, sonra `needs_human`.
6. **Sır maskeleme:** loglara yazmadan önce token/anahtar pattern'leri redacte et.

## Kill-switch'ler
- **Job durdur:** dashboard'da tek tıkla aktif run'ı iptal + worktree temizle.
- **Tümünü durdur:** worker'ı drain moduna al (yeni job alma, mevcutları bitir/iptal).
- **Şerit kapat:** premium veya cheap şeridi manuel kapat (limit/maliyet için).

## Bakım tuzağına karşı (en sinsi risk)
- **Yüzey = bakım.** Her MCP, her entegrasyon bozulabilir. Önce 1 senaryo, dar.
- **Kullanılmayanı sil.** 2 haftadır dokunulmayan MCP/entegrasyon → kaldır.
- **Haftalık retro:** "bu hafta sistemi mi tamir ettim, yoksa sistem bana mı çalıştı?" Cevap "tamir" ise kapsamı daralt.
- **Hedef sağlaması:** amaç sana zaman + para kazandırmak. Sistem net zaman kazandırmıyorsa, özellik eklemeyi bırak, sadeleştir.

## Etik / yasal
- Telif: lisanssız kod/içerik üretme/kopyalama yok.
- Veri: kişisel/müşteri verisi loglama, dışarı verme yok.
- Şeffaflık: agent üretimi içerik (özellikle marketing) insan onayından geçer.

## Olay anı (bir şey patlarsa)
1. Kill-switch (job/tümünü durdur).
2. `runs` + `usage_log`'tan son adımları oku.
3. Kök neden → `04_CONTEXT_TRACKER.md` açık sorulara, kalıcı düzeltme → karar günlüğüne.
4. Guardrail eksikse buraya yeni satır ekle.
