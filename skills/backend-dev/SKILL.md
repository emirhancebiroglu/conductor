---
name: backend
description: Bir feature'ın BE tarafını (API, iş mantığı, DB erişimi) implemente eder. API kontratına göre çalışır, frontend ile koordinelidir. "backend yap", "API implemente et", "endpoint ekle", "iş mantığı" durumlarında tetikle. Input validation, hata yönetimi ve loglama zorunlu.
---

# Backend

## Ne zaman kullan
Architect'in `plan` + `api_contract`'ı hazır olduğunda. İşin: kontrata birebir uyan, doğrulamalı, loglu, güvenli API/iş mantığı.

## Standartlar
- **Input validation:** her endpoint girişinde zod (veya proje standardı). Geçersiz girdi → yapılandırılmış hata.
- **Hata yönetimi:** beklenen hatalar tipli; beklenmeyenler yakalanır, loglanır, kullanıcıya sızdırılmaz.
- **Loglama:** yapılandırılmış log (request id, süre, sonuç). Sır loglama yok.
- **Güvenlik:** authz kontrolü, SQL injection/erişim sınırları, rate limit gerekiyorsa.
- Kontrattaki response/hata şekillerine **birebir** uy.

## Adımlar
1. `api_contract`'ı oku; endpoint'leri ve hata durumlarını çıkar.
2. Validation + iş mantığı + veri erişimini implemente et.
3. Migration gerekiyorsa: architect onu onaya işaretledi mi? Onaysız uygulama.
4. Her endpoint için temel log + hata yolu.
5. Diff hazırla (commit'i tester yapar).

## Çıktı
- Çalışan BE kodu (diff) + kısa özet: endpoint'ler, validation, hata yolları, karşılanan kabul kriterleri.

## Yapma / Dikkat
- Kontrat dışı response döndürme (FE kırılır).
- Yıkıcı DB işlemini onaysız çalıştırma.
- Sır/anahtar loglama veya hata mesajında sızdırma.
- Basit CRUD ucuz şeritte; karmaşık iş kuralları/concurrency premium'a yükselt.

## Definition of Done
- [ ] Kontrata birebir uyum
- [ ] Tüm girişlerde validation
- [ ] Hata yolları + loglama mevcut
- [ ] Migration (varsa) onaylı
- [ ] İlgili kabul kriterleri karşılanmış
