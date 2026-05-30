# 08 — Cost & Limits

> Senin durumun: **sabit ücretli abonelikler** (Claude Pro ~$20 + OpenCode Go ~$10). Bu yüzden "token başı %60 tasarruf" tavsiyeleri büyük ölçüde **geçersiz** — sen token başı ödemiyorsun. Senin işin **limit yönetimi**: işi doğru şeride atayıp iki aboneliğin kullanım limitlerini şişirmeden idare etmek.

## Gerçek maliyet tablosu (senin stack)
| Kalem | Tip | Yaklaşık |
|-------|-----|----------|
| Claude Pro | sabit abonelik | ~$20/ay |
| OpenCode Go | sabit abonelik (limitli) | ~$10/ay |
| Supabase | free tier yeter (v1) | $0 |
| Vercel (dashboard) | hobby/free | $0 |
| Worker VM | küçük instance | ~$5-10/ay |
| **Toplam** | | **~$35-40/ay** |

> OpenCode Go limiti istek sayısı değil, **dolar-eşdeğeri**: ~$12/5sa, $30/hafta, $60/ay. Bu "tavanları" aşmadan idare etmek = işin. Çok ucuz modeller (MiniMax/DeepSeek Flash sınıfı) bu tavanı çok yavaş yer; pahalı açık modeller hızlı yer.

## Şerit yönlendirme politikası (router)
```
GÖREV TİPİ                         → ŞERİT (model)
─────────────────────────────────────────────────────
dosya gezme, grep, arama           → cheap (en ucuz Go modeli)
boilerplate, ilk taslak kod        → cheap (orta Go modeli: GLM/Kimi sınıfı)
basit unit test üretimi            → cheap
karmaşık iş mantığı / algoritma    → premium (Claude Code)
mimari karar, API tasarımı         → premium
final code review                  → premium
güvenlik-hassas kod                → premium
"2 turdur düzelmiyor" debug        → premium (yükselt)
```
**Yükseltme (escalation) kuralı:** cheap ile başla; agent "takıldım / belirsiz / tekrar fail" sinyali verirse aynı görevi premium'a yükselt ve `runs.lane='premium'` yaz.

## Maliyeti düşüren teknikler (abonelikte bile değerli — limit yer)
1. **Context'i daralt.** Agent'a tüm repoyu değil, ilgili dosyaları ver. En büyük tasarruf kalemi.
2. **Subagent izolasyonu.** Arama ayrı context'te yapılsın, sadece sonuç ana akışa dönsün.
3. **Prompt caching.** Sabit sistem promptu/skill'ler cache'lensin (tekrar eden girdi ucuzlar).
4. **max_tokens sınırla.** Sınıflandırma/karar adımlarına kısa çıktı limiti koy.
5. **Döngü turunu sınırla.** Reviewer/tester max 3 tur (doc 05) — sonsuz döngü = sonsuz tüketim.
6. **Batch.** Acil olmayan toplu işleri (örn. araştırma) ucuz şeritte topla.

## Limit guardrail'leri (kod)
```
ESIKLER (config):
  GO_5H_SOFT = $9   (tavan $12'nin %75'i)
  GO_WEEK_SOFT = $24
  GO_MONTH_SOFT = $50

DAVRANIŞ:
  soft eşik aşıldı → router premium'a yönlendirmeyi azaltır,
                     yeni cheap çağrıları en ucuz modele sabitler
  tavan yaklaştı   → yeni job kabulünü duraklat, dashboard'da uyar
  premium (Pro) limit'i → o şeridi geçici kapat, cheap'e düş veya 'needs_human'
```
- Her `run()` `usage_log`'a tahmini maliyet yazar; router toplamları okuyup karar verir.
- **Kill-switch:** dashboard'da "tüm job'ları durdur" butonu (panik freni).

## Dashboard görünürlüğü (Faz 4)
- Canlı: aktif run'lar + hangi şerit/model.
- Sayaçlar: bugünkü / bu haftaki / bu ayki tahmini tüketim + limit barı (yeşil/sarı/kırmızı).
- Uyarı: soft eşiğe gelince banner.

## Önemli gerçeklik notu
Always-on, çok-agent'lı, web-search + E2E loop'lu ağır kullanım, sabit aboneliklerin limitlerini **hızlı** yer. Beklenti: bu sistem "sınırsız bedava işçi" değil; **dar kapsamlı, insan-kapılı, ölçülü** çalıştığında zaman+para kazandırır. Limit yiyorsan: kapsamı daralt, context'i kıs, ucuz şeride daha çok it — yeni abonelik almadan önce bunları dene.
