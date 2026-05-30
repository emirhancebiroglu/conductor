# 07 — Skills

> Skill = bir agent'ın belirli bir işi "doğru" yapması için yazılmış talimat paketi (`SKILL.md` + opsiyonel referans/şablon). Bu projede her agent rolünün bir skill'i var. Hazır (public) skill'lerden de yararlanıyoruz.

## Bu proje için yazılan skill'ler
Konum: `skills/<rol>/SKILL.md`. Worker, ilgili agent'ı çalıştırırken bu dosyayı bağlama yükler.

| Skill | Dosya | Özet |
|-------|-------|------|
| product-owner | `skills/product-owner/SKILL.md` | Kısa açıklama → web araştırmalı detaylı spec + kabul kriterleri |
| architect | `skills/architect/SKILL.md` | Teknik plan, görev kırılımı, API kontratı, branch stratejisi |
| frontend | `skills/frontend/SKILL.md` | 2026 UI/UX + a11y standardında FE implementasyonu |
| backend | `skills/backend/SKILL.md` | API/DB/iş mantığı, validation, hata yönetimi, log |
| code-reviewer | `skills/code-reviewer/SKILL.md` | Review checklist + "temiz olana kadar" döngü protokolü |
| tester | `skills/tester/SKILL.md` | Unit+edge+E2E (Playwright), pass'e kadar döngü, commit+PR |

### SKILL.md formatı (uyulacak kural)
```markdown
---
name: rol-adi
description: Ne yapar + NE ZAMAN tetiklenir (biraz "pushy" yaz, agent az-tetikler).
---
# Başlık
## Ne zaman kullan
## Girdi / Çıktı (şema)
## Adımlar
## Yapma / Dikkat
## Definition of Done
```
- SKILL.md < 500 satır; uzarsa `references/` alt dosyalara böl.
- "Ne zaman" bilgisi **description**'da olur (tetikleme buradan).
- Çıktı şeması net olsun (handoff için, doc 05).

---

## Yararlandığımız hazır (public) skill'ler
Claude Code/Cowork ortamında gelen skill'ler — yeniden yazma, **referansla**:

| Skill | Ne zaman | Bu projede nerede |
|-------|----------|-------------------|
| **frontend-design** | web UI/komponent kurma, stil | frontend agent buna dayanır |
| **docx / pdf / pptx / xlsx** | belge üretimi | fikir→MVP'de PRD/rapor çıktısı (ops.) |
| **mcp-builder** (örnek) | kendi MCP'ni yazma | ileride özel MCP gerekirse |
| **skill-creator** (örnek) | yeni skill yazma/iyileştirme | bu skill'leri evrimleştirmek için |

> Public skill varsa onu kullan; kendi skill'ini sadece projeye özel davranış için yaz.

---

## Skill yazım disiplini
1. **Önce dar yaz, sonra evrimleştir.** İlk sürüm kısa olsun; gerçek hatalardan öğrenip ekle.
2. **Örnekle.** İyi/kötü çıktı örneği, kuru kuraldan iyi öğretir.
3. **Çıktı formatını zorla.** "JSON döndür, sadece JSON" gibi net talimat (handoff bozulmasın).
4. **Versiyonla.** Skill değişince `04_CONTEXT_TRACKER.md`'ye not düş.
5. **Test et.** skill-creator döngüsü: birkaç örnek feature'da çalıştır, çıktıyı incele, düzelt.
