# Conductor 🎼

> Sen yönetirsin (man in the middle), agent'lar çalar. GitHub'a bağlan, projeni seç, feature'ı anlat → bir agent ekibi planlar, kodlar, test eder ve sana **onaylaman için bir PR** açar. Main'e merge'ü her zaman sen yaparsın.

Bu repo bir **kontrol düzlemi** (dashboard) + bir **yürütme düzlemi** (agent worker) içerir. Amaç: maksimum otomasyon, minimum maliyet, maksimum zaman tasarrufu — kendine zaman ve maddi rahatlık kazandırmak.

## Bu dokümanları hangi sırayla okumalı

| # | Dosya | Ne işe yarar |
|---|-------|--------------|
| 0 | [`docs/00_MASTER_PLAN.md`](docs/00_MASTER_PLAN.md) | A-Z plan, fazlar, milestone'lar, deadline'lar |
| 1 | [`docs/01_ARCHITECTURE.md`](docs/01_ARCHITECTURE.md) | Sistem mimarisi, iki şerit, veri akışı, insan kapıları |
| 2 | [`docs/02_TECH_STACK.md`](docs/02_TECH_STACK.md) | Somut teknoloji seçimleri + gerekçeler |
| 3 | [`docs/03_TASK_TRACKER.md`](docs/03_TASK_TRACKER.md) | Görev kırılımı, tahminler, deadline, durum |
| 4 | [`docs/04_CONTEXT_TRACKER.md`](docs/04_CONTEXT_TRACKER.md) | Canlı durum, karar günlüğü, açık sorular, sözlük |
| 5 | [`docs/05_AGENT_TEAM.md`](docs/05_AGENT_TEAM.md) | Agent rolleri, handoff protokolü, model şeridi |
| 6 | [`docs/06_MCPS.md`](docs/06_MCPS.md) | Kullanılacak MCP sunucuları + config |
| 7 | [`docs/07_SKILLS.md`](docs/07_SKILLS.md) | Bu proje için yazılacak skill'ler + hazır skill'ler |
| 8 | [`docs/08_COST_AND_LIMITS.md`](docs/08_COST_AND_LIMITS.md) | Maliyet modeli, şerit yönlendirme, limit guardrail'leri |
| 9 | [`docs/09_PRODUCT_IDEA_TO_MVP.md`](docs/09_PRODUCT_IDEA_TO_MVP.md) | Fikir → MVP otomasyon hattı |
| 10 | [`docs/10_RISKS_AND_GUARDRAILS.md`](docs/10_RISKS_AND_GUARDRAILS.md) | Riskler, kill-switch'ler, güvenlik kapıları |
| — | [`CLAUDE.md`](CLAUDE.md) | Agent'ların okuduğu kök kurallar dosyası |

## 30 saniyede zihinsel model

```
Sen (dashboard)  ──►  Job (feature isteği)  ──►  Worker (VM)
                                                    │
        ┌───────────────────────────────────────────┘
        ▼
  Agent ekibi:  PO → Architect → FE+BE → Reviewer (loop) → Tester (loop)
        │
        ▼
  feature branch + commit + push  ──►  PR açılır
        │
        ▼
  ⛔ İNSAN KAPISI: PR'ı sen incele → onayla/reddet → main'e merge SEN yap
```

## İki şerit (cost)
- **Ucuz şerit** = OpenCode + OpenCode Go (açık modeller). Bulk iş: grep, boilerplate, ilk taslak, basit testler.
- **Premium şerit** = Claude Code (Claude Pro). Zor iş: mimari kararlar, final review, karmaşık debug.

Detay: [`docs/08_COST_AND_LIMITS.md`](docs/08_COST_AND_LIMITS.md)

## Altın kurallar (asla unutma)
1. **Main'e otomatik merge YOK.** Agent PR açar, sen merge edersin.
2. **Dar kapsam.** Bir job = bir feature. Zincir uzadıkça hata çarpışarak büyür.
3. **Olgun parçayı satın al, tutkalı yaz.** issue→PR motorunu sıfırdan yazma.
4. **Her şeyi logla.** Görmediğin maliyeti yönetemezsin.
5. **Önce kendi projende dogfood.** Başkasına satmadan önce sana çalıştığını kanıtla.
