# 05 — Agent Team (v2 — 8 Agent)

## Pipeline

```
PO → Codebase Analyst → Tech Lead → BE → FE
                                          │
                              Security⟲ ←─┘
                                 │ (2 turda geçemezse → Tech Lead redesign → BE+FE redo)
                                 │ (redesign de geçemezse → needs_human)
                              Reviewer⟲
                                 │ (3 tur, sonra needs_human)
                               QA⟲
                                 │ (3 tur, sonra needs_human)
                                 ▼
                            commit → push → PR
                                          ⛔ İNSAN KAPISI
```

## Roster

| # | Agent | Tek görevi | Girdi | Çıktı | Şerit |
|---|-------|-----------|-------|-------|-------|
| 1 | **product-owner** | Kısa açıklama → spec + kabul kriterleri | job.description | Spec JSON | Premium |
| 2 | **codebase-analyst** | Repo'yu tara → context.md | repo, spec | context.md | Cheap |
| 3 | **tech-lead** | Sistem tasarımı + task kırılımı + API kontratı | spec + context.md | Plan JSON | Premium |
| 4 | **backend-dev** | API / DB / iş mantığı / validation | plan + context.md | BE diff | Cheap→Premium |
| 5 | **frontend-dev** | UI / UX / state / API entegrasyonu | plan + API contract + context.md | FE diff | Cheap→Premium |
| 6 | **security-reviewer** | OWASP, auth, injection, data exposure ⟲ | diff + context.md | SecurityReview JSON | Premium |
| 7 | **code-reviewer** | Kalite, pattern, perf, correctness ⟲ | diff | Review JSON | Premium |
| 8 | **qa-engineer** | Unit + E2E → pass → commit → PR ⟲ | repo | TestResult JSON | Cheap+Premium |

---

## Handoff şemaları (zod)

```ts
// Spec — PO çıktısı
{ summary, user_stories, acceptance_criteria, out_of_scope,
  open_questions, research_notes: [{claim, source}] }

// Plan — Tech Lead çıktısı
{ approach, complexity: 'simple'|'medium'|'complex',
  sub_features: null | [{title, description}],   // complex → auto sub-job
  affected_modules, api_contract: { shared_types, endpoints },
  tasks: [{id, area, desc, acceptance}],
  branch, needs_migration, migration, risks }

// SecurityReview
{ passed: boolean, escalate_to_tech_lead: boolean,
  issues: [{file, line, severity:'critical'|'high'|'med',
             category:'auth'|'injection'|'exposure'|'secret'|'other',
             problem, fix}] }

// Review (code quality)
{ approved: boolean, escalate: boolean,
  issues: [{file, line, severity:'high'|'med'|'low',
             problem, fix, owner:'frontend'|'backend'}] }

// TestResult
{ passed: boolean, needs_human: boolean,
  unit: {added, passing}, e2e: {scenarios, passing},
  failures: string[], commit_message: string }
```

---

## Codebase Analyst — neden kritik

Olmadan: her agent repoyu hiç görmemiş gibi kod yazar → uyumsuz pattern, tekrar eden abstraction, var olan convention'lara uymayan isimler.

Olduğunda: her agent `context.md`'yi okur ve **o repoda yıllardır çalışan biri gibi** davranır.

`context.md` içeriği:
```
## Mimari pattern'ler
## Naming / dosya convention'ları
## Mevcut abstraction'lar (hangi util/hook/service/middleware var)
## Test convention'ları (bu repoda test nasıl yazılıyor)
## Bu feature ile ilgili dosyalar (muhtemelen değişecekler)
## Teknik borç / dikkat noktaları
## Anti-pattern'ler (bu repoda yapılmaması gerekenler)
```

---

## Complexity → Auto Sub-Job

Tech Lead `complexity='complex'` ve `sub_features` dolu döndürürse:

```
Orchestrator:
  → Her sub_feature için Supabase'e yeni job yazar
    (parent_job_id referansıyla, type='feature', status='queued')
  → Parent job status='decomposed' olur
  → Dashboard: "Bu feature 3 alt feature'a bölündü" + child job linkleri
  → Her child bağımsız pipeline'dan geçer → ayrı PR
  → Sen N adet PR onaylarsın
```

**Neden sormadan otomatik:** Tech Lead spec + codebase context'ini gördükten sonra en bilgili pozisyonda. Sormak gereksiz gecikme.

---

## Security → Tech Lead Redesign Döngüsü

```
BE + FE implement eder
  → Security⟲ max 2 tur:
      tur 1: sorunları BE/FE'ye gönder → fix → security tekrar
      tur 2: hâlâ fail
        → escalate_to_tech_lead=true
        → Tech Lead: security sorunları + mevcut plan alır
        → Yeni plan (security-safe yaklaşım) üretir
        → BE + FE yeniden implement
        → Security tekrar (max 2 tur)
        → Hâlâ fail → needs_human (güvenlik açığı çözülemedi)
  → Security PASS → Code Reviewer'a geç
```

Max güvenli: 2 security turu + 1 redesign + 2 security turu = 5 security agent çalışması, bounded.

---

## Loop özeti

| Agent | Max tur | Fail sonrası |
|-------|---------|-------------|
| Security | 2 | → Tech Lead redesign (1 kez), sonra needs_human |
| Code Reviewer | 3 | → needs_human |
| Tester | 3 | → needs_human |

---

## Orchestrator sözde kodu

```
spec = PO(job)
if spec.open_questions: → needs_human

context = CodebaseAnalyst(repo, spec)
plan = TechLead(spec, context)

if plan.complexity == 'complex' && plan.sub_features:
  createSubJobs(plan.sub_features, parentJobId)
  markDecomposed(job)
  return

for i in 1..2:
  runBackend(plan, context)
  runFrontend(plan, context)
  secResult = Security(diff, context)
  if secResult.passed: break
  if secResult.escalate_to_tech_lead and i == 1:
    plan = TechLead(spec, context, securityIssues=secResult.issues)
    continue
  if i == 2: → needs_human('security')

for i in 1..3:
  rev = Reviewer(diff)
  if rev.approved: break
  applyFixes(rev.issues)
  if i == 3: → needs_human('review')

for i in 1..3:
  t = Tester(repo)
  if t.passed: break
  applyFixes(t.failures)
  if i == 3: → needs_human('test')

commit(t.commit_message) → push → PR → STOP ⛔
```

---

## Model lane özeti

| Görev | Şerit | Gerekçe |
|-------|-------|---------|
| PO | Premium (kısa) | Spec kalitesi tüm pipeline'ı belirler |
| Codebase Analyst | Cheap | Dosya okuma, az generation |
| Tech Lead | Premium | Mimari karar, en kritik |
| BE/FE (ilk) | Cheap | Bulk implementasyon |
| BE/FE (fix) | Premium | Tekrar düzeltemediyse derin sorun |
| Security | Premium | Güvenlik kör nokta kabul etmez |
| Reviewer | Premium | Quality gate |
| Tester (yazma) | Cheap | Test üretimi |
| Tester (debug) | Premium | Fail analizi |
