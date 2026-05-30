# 09 — Product Idea → MVP

> İkinci hat: bir cümlelik fikir → araştırma → doğrulama → PRD → MVP kapsamı → repo scaffold → **feature pipeline'a otomatik devir**. Aynı `jobs`/worker/dashboard altyapısını kullanır; sadece `type='idea'`.

## Akış
```
Sen: "X için bir araç" (bir cümle)
   ▼
[research]   pazar + rakip + pain araştırması (web + Product Hunt + Reddit)
   ▼
[validate]   talep sinyali, farklılaşma, risk → GIT/DEVAM kararı (insan kapısı)
   ▼
[prd]        PRD + MVP kapsamı (must/should/won't) + tech seçim
   ▼  ⛔ İNSAN KAPISI: PRD'yi onayla/düzelt
[scaffold]   repo iskeleti üret (stack doc 02) + ilk feature listesi
   ▼
[handoff]    feature'lar 'feature' job'u olarak sıraya girer → Senaryo 1 hattı
```

## Agent rolleri (idea hattı)
| Agent | İş | Çıktı | Şerit |
|-------|----|-------|-------|
| **market-researcher** | pazar/rakip/trend taraması | bulgular + kaynaklar | cheap (toplu arama) |
| **pain-analyst** | gerçek kullanıcı acıları (Reddit/PH/forum) | pain listesi + alıntı/kaynak | cheap |
| **validator** | sinyal + farklılaşma + risk değerlendir | git/devam + gerekçe | premium |
| **product-manager** | PRD + MVP kapsam + tech seçim | `prd.md` (insan onayı) | premium |
| **scaffolder** | repo iskeleti + ilk feature backlog | repo + `jobs` kayıtları | cheap→premium |

## Çıktı şablonları
**PRD (`prd.md`) iskeleti:**
```
# <Ürün> PRD
## Problem (kaynaklı)
## Hedef kullanıcı
## Değer önerisi / farklılaşma
## MVP kapsamı  (Must / Should / Won't-now)
## Başarı metrikleri
## Tech seçim (doc 02 referans)
## Riskler & açık sorular
## İlk 5 feature (feature pipeline'a girecek)
```

## İnsan kapıları (idea hattı)
- **validate sonrası:** GIT/DEVAM kararını sen onayla (boşa kod yazma).
- **PRD sonrası:** kapsamı sen kilitle — scaffold ondan sonra.
- Scaffold ve ilk feature'lar otomatik; ama her feature yine **PR + senin merge'in** kapısından geçer.

## Maliyet notu
Araştırma adımları çok token yer (web fetch + uzun bağlam). Bunları **ucuz şeritte ve batch** çalıştır; sadece `validator` ve `product-manager` premium. Aksi halde OpenCode Go haftalık limitini hızlı yersin (doc 08).

## Kapsam uyarısı
Bu hat **Faz 5**'te gelir — feature pipeline (Senaryo 1) sağlam çalışmadan buna girme. Önce sana çalıştığını kanıtla, sonra fikir hattını ekle.
