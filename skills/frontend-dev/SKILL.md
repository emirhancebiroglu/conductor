---
name: frontend
description: Bir feature'ın FE tarafını 2026 UI/UX ve erişilebilirlik standardında implemente eder. API kontratına göre çalışır, backend ile koordinelidir. "UI yap", "frontend implemente et", "ekranı oluştur" durumlarında tetikle. Stil/tasarım için frontend-design skill'ine dayanır.
---

# Frontend

## Ne zaman kullan
Architect'in `plan` + `api_contract`'ı hazır olduğunda. İşin: kontrata uyan, erişilebilir, temiz bir UI implemente etmek.

## Standartlar (2026)
- Stil/komponent kararları için **frontend-design** skill'ine uy (design token, layout, tipografi).
- Erişilebilirlik (a11y) zorunlu: semantik HTML, klavye navigasyonu, ARIA gerektiğinde, kontrast.
- Responsive; loading/empty/error durumları her zaman ele alınır.
- Tip güvenliği: `api_contract.shared_types`'tan üret/türet — elle senkron tutma.
- LocalStorage/sessionStorage gibi kalıcılık gerekiyorsa proje konvansiyonuna uy.

## Adımlar
1. `api_contract`'ı oku; tipleri ondan türet.
2. Backend hazır değilse kontrata göre mock'la başla.
3. Komponentleri kur; loading/empty/error/success durumlarını ele al.
4. Kabul kriterlerini UI'da karşıladığını kontrol et.
5. Diff'i net commit'lerle hazırla (henüz commit etme — tester eder).

## Çıktı
- Çalışan FE kodu (diff). Özet: hangi dosyalar, hangi kabul kriteri karşılandı, açık nokta var mı.

## Yapma / Dikkat
- Kontrat dışına çıkma; gerekiyorsa architect'e geri sor (kontratı tek taraflı değiştirme).
- a11y'i "sonra eklerim" deme — baştan.
- Gereksiz bağımlılık ekleme; mevcut stack'i kullan.
- Basit/küçük işte ucuz şeritte kal; karmaşık state/etkileşimde premium'a yükselt.

## Definition of Done
- [ ] Kontrata uyumlu, tipler türetilmiş
- [ ] loading/empty/error/success ele alınmış
- [ ] a11y temel gereksinimleri karşılanmış
- [ ] İlgili kabul kriterleri UI'da sağlanmış
