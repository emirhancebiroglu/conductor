# 05 — Agent Team

> Mini bir dev ekibi. Her rolün **tek bir işi**, **net bir girdisi** ve **yapılandırılmış bir çıktısı** var. Çıktı, bir sonraki agent'ın girdisidir (handoff). Roller dar tutulur çünkü zincir uzadıkça hata çarpışarak büyür.

## Roster

| Agent | İş | Girdi | Çıktı | Varsayılan şerit |
|-------|----|-------|-------|------------------|
| **Orchestrator** | sırayı ve döngüleri yönetir, router'ı çağırır | job | run kayıtları, durum | — (kod) |
| **product-owner** | kısa açıklamayı detaylı spec'e çevirir (web research) | `job.description` | `spec` (kabul kriterleri) | premium (kısa) |
| **architect** | teknik plan, görev kırılımı, API kontratı, branch | `spec` | `plan` + `api-contract` | premium |
| **frontend** | UI/UX'i 2026 standardında implemente eder | `plan`, `api-contract` | FE diff | cheap→premium |
| **backend** | API/DB/iş mantığını implemente eder (FE ile koordineli) | `plan`, `api-contract` | BE diff | cheap→premium |
| **code-reviewer** | diff'i inceler, sorunları geri gönderir (⟲) | diff | onay veya düzeltme talebi | premium |
| **tester** | unit+edge+E2E, pass olana kadar (⟲), commit+PR | kod | testler, commit, **PR** | cheap (test) + premium (debug) |

Skill tanımları: `skills/<rol>/SKILL.md`.

---

## Handoff protokolü (önemli)
Her agent çıktısını **zod ile doğrulanan JSON** olarak verir; orchestrator bunu `runs.output`'a yazar ve sonraki agent'a girdi yapar. Serbest metin handoff yok — drift'i bu engeller.

Örnek `spec` şeması:
```ts
const Spec = z.object({
  summary: z.string(),
  user_stories: z.array(z.string()),
  acceptance_criteria: z.array(z.string()).min(1),
  out_of_scope: z.array(z.string()),
  open_questions: z.array(z.string()),   // doluysa → needs_human
  research_notes: z.array(z.object({ claim: z.string(), source: z.string() })),
});
```
`open_questions` boş değilse orchestrator job'u `needs_human`'a çeker; varsayımla devam YOK.

Örnek `api-contract` (FE+BE'nin koordinasyon noktası):
```ts
const ApiContract = z.object({
  endpoints: z.array(z.object({
    method: z.enum(['GET','POST','PUT','PATCH','DELETE']),
    path: z.string(),
    request: z.any(),     // zod şema referansı/şekli
    response: z.any(),
    errors: z.array(z.string()),
  })),
  shared_types: z.string(),  // ortak tip tanımları (TS)
});
```
FE ve BE **aynı kontrattan** çalışır → entegrasyon sürprizi olmaz.

---

## Döngü koşulları (⟲)
- **Reviewer döngüsü:** reviewer `approved=false` döndürdükçe, sorunları ilgili agent'a (FE/BE) geri gönder. **Max 3 tur.** 3'te de temizlenmezse → `needs_human`, dashboard'da reviewer notlarını göster.
- **Tester döngüsü:** unit+E2E fail oldukça ilgili agent'a fail logunu gönder. **Max 3 tur.** Sonra → `needs_human`.
- Her tur `runs.iteration`'ı artırır; dashboard "tur 2/3" gibi gösterir.
- **Neden max var:** sonsuz döngü = sonsuz maliyet + sonsuz drift. Kapıyı insana aç.

---

## FE ↔ BE koordinasyonu
İki seçenek, v1 için **A**:
- **A (basit, sıralı):** architect kontratı sabitler → BE implemente eder → FE kontrata göre implemente eder (mock'la başlar). Daha az çakışma.
- **B (paralel, ileri):** OpenCode agent-team ile FE+BE paralel; mesajlaşma + paylaşılan task board. Faz 3 sonrası dene.

---

## Model şeridi (cost) — özet
- **Cheap (OpenCode Go):** dosya gezme, grep, boilerplate, ilk taslak, basit unit test → MiniMax/DeepSeek Flash sınıfı (çok yüksek istek limiti).
- **Premium (Claude Code/Pro):** mimari, final review, karmaşık debug, güvenlik-hassas kod.
- **Yükseltme kuralı:** cheap ile başla; agent "takıldım / belirsiz / 2 turdur düzelmiyor" sinyali verirse premium'a yükselt.
- Tam policy: `docs/08_COST_AND_LIMITS.md`.

---

## Orchestrator akışı (sözde kod)
```
job = takeQueued()
mark(job, 'running'); branch = openFeatureBranch(job)
spec = run('product-owner', job.description)
if spec.open_questions.length: return needHuman(job, spec.open_questions)
plan = run('architect', spec)
if plan.needs_migration: requireApproval(job, 'db_migration', plan.migration)
be = run('backend', plan)            // A: sıralı
fe = run('frontend', plan, be.contract)
for i in 1..3:
   rev = run('code-reviewer', diff())
   if rev.approved: break
   applyFixes(rev.requests)          // ilgili agent'a geri
else: return needHuman(job, rev)
for i in 1..3:
   t = run('tester', repo)
   if t.passed: break
   applyFixes(t.failures)
else: return needHuman(job, t)
commit(t.message); push(branch); pr = openPR(job, branch)
mark(job, 'pr_opened', pr.url)       // ⛔ insan: merge SEN
```
> Her `run()` çağrısı router'dan şerit/model alır ve `usage_log` yazar.
