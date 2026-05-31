# 03 — Task Tracker

> Durum işaretleri: `[ ]` yapılacak · `[~]` devam · `[x]` bitti · `[!]` bloke
> Her görevi bitirince işaretle + `04_CONTEXT_TRACKER.md`'yi güncelle. Saat tahmini kayarsa **tahmini düzelt, kapsamı değil**.

## Lejant
- **ID:** T-### · **Est:** kabaca saat · **DL:** hedef bitiş · **Dep:** bağımlılık

---

## Faz 0 — Foundations · DL 2026-06-07
- [*] **T-001** Hesaplar: GitHub App/PAT, Supabase, OpenCode Go key, Claude Pro login · Est 2 · Dep —
- [*] **T-002** Worker VM (Fly/Railway/VPS): Node 22, git, OpenCode CLI, Claude Code CLI, Playwright kur · Est 2 · Dep T-001
- [*] **T-003** Monorepo iskeleti (pnpm workspaces, apps/, packages/) · Est 1 · Dep —
- [*] **T-004** Supabase şema migrate (projects, jobs, runs, usage_log, approvals) · Est 1 · Dep T-001
- [*] **T-005** "Hello agent" scripti: clone → branch → README satırı → commit → push → PR (Octokit) · Est 2 · Dep T-002,T-004
- [*] **M0** ✅ Elle tetiklenen script gerçek PR açıyor · Dep T-005

## Faz 1 — Control plane MVP · DL 2026-06-21
- [*] **T-101** Next.js + Tailwind + shadcn iskelet, tek-kullanıcı auth (Supabase) · Est 3 · Dep T-003
- [*] **T-102** GitHub App/OAuth bağla → repo listesini çek · Est 4 · Dep T-001,T-101
- [*] **T-103** "Projeyi bağla/seç" ekranı → `projects` kaydı · Est 3 · Dep T-102,T-004
- [*] **T-104** "New feature" formu (başlık, açıklama, branch, lane) → `POST /api/jobs` · Est 4 · Dep T-103
- [x] **T-105** Job listesi + detay sayfası · Est 4 · Dep T-104
- [x] **T-106** Supabase Realtime → job durumu canlı güncelleme · Est 3 · Dep T-105
- [x] **T-107** API input validation (zod) + hata yönetimi · Est 2 · Dep T-104
- [x] **M1** ✅ Dashboard'dan feature → DB'de queued job, listede görünüyor · Dep T-106

## Faz 2 — Execution plane (happy path) · DL 2026-06-28
- [*] **T-201** Worker: job poll/subscribe döngüsü, `running`'e çek · Est 3 · Dep T-004
- [*] **T-202** Git worktree yönetimi: izole klon + `feature/<slug>` aç · Est 3 · Dep T-201
- [*] **T-203** Tek agent runner (Claude Code `claude -p` adaptörü) · Est 4 · Dep T-002,T-202
- [*] **T-204** Commit + push + PR aç → `pr_url` yaz · Est 3 · Dep T-203
- [*] **T-205** Hata yakalama + `failed` + log → `runs` · Est 2 · Dep T-203
- [*] **T-206** Worktree temizliği (başarı/başarısızlık sonrası) · Est 1 · Dep T-202
- [*] **M2** ✅ Dashboard'dan basit feature → dakikalar içinde gerçek PR linki ekranda · Dep T-204

## Faz 3 — Agent ekibi · DL 2026-07-12
- [*] **T-301** Orchestrator iskelet: sıralı + koşullu adımlar, state machine, sub-job decomposition · Est 4 · Dep T-203
- [*] **T-302** Handoff şemaları: Spec, Plan (complexity+sub_features), SecurityReview, Review, TestResult (zod) · Est 3 · Dep T-301
- [ ] **T-303** product-owner agent + skill (web research, open_questions → needs_human) · Est 2 · Dep T-302
- [*] **T-304** codebase-analyst agent + skill (context.md üretimi, cheap lane) · Est 3 · Dep T-302
- [*] **T-305** tech-lead agent + skill (plan, API kontrat, complexity, sub-job, redesign modu) · Est 4 · Dep T-303,T-304
- [*] **T-306** backend-dev + frontend-dev agent (implement + fix + security-fix + review-fix + test-fix modları) · Est 5 · Dep T-305
- [*] **T-307** security-reviewer döngüsü (max 2 tur → Tech Lead redesign → max 2 tur → needs_human) · Est 4 · Dep T-306
- [*] **T-308** code-reviewer döngüsü (max 3 tur → needs_human) · Est 3 · Dep T-307
- [*] **T-309** qa-engineer döngüsü: unit + edge + Playwright E2E (max 3 tur → needs_human) → commit → PR · Est 5 · Dep T-308
- [*] **T-310** OpenCode cheap lane runner adaptörü (runAgentForJSON + runAgentFreeText) · Est 3 · Dep T-301
- [*] **T-311** createSubJobs: complex feature → N child job → parent status='decomposed' · Est 2 · Dep T-305
- [*] **M3** ✅ Orta zorlukta feature → 8-agent ekip → security+review+test → PR · Dep T-309,T-310,T-311

## Faz 4 — Router + observability + kapılar · DL 2026-07-19
- [*] **T-401** Router: role+complexity → şerit/model seçimi (policy doc 08) · Est 4 · Dep T-308
- [*] **T-402** `usage_log` yaz: her çağrıda model+token+tahmini maliyet · Est 3 · Dep T-401
- [*] **T-403** Limit guardrail: eşik yaklaşınca premium kapat / ucuza düş / durdur · Est 3 · Dep T-402
- [*] **T-404** Dashboard: canlı run adımları + log viewer · Est 4 · Dep T-106
- [*] **T-405** Dashboard: maliyet sayacı + limit barı · Est 2 · Dep T-402
- [*] **T-406** Onay kapıları UI: `approvals` (migration/merge) onayla/reddet · Est 3 · Dep T-105
- [*] **M4** ✅ "Ne çalışıyor, ne kadar, neyi onaylamalıyım" tek bakışta · Dep T-405,T-406

## Faz 5 — Fikir→MVP hattı · DL 2026-07-26

- [ ] **T-501** 'idea' job tipi + DB (prd, prd_approved, research_output, 
      scaffold_repo alanları + idea_exhausted status) · Est 2 · Dep M4
- [ ] **T-502** Scout agent + skill (tema opsiyonel → kendi 3 alan seçer,
      PH/Reddit/HN/Trends web araştırması, fikir üretimi, 5 boyut skoru,
      top 5 listesi) · Est 5 · Dep T-501
- [ ] **T-503** Executioner agent + skill (kill test, her fikre 3 ölüm 
      senaryosu, 2-3 hayatta kalan + "neden öldü" raporu) · Est 3 · Dep T-502
- [ ] **T-504** Advocate agent + skill (Claude premium, fikrin en iyi 
      versiyonu, top %1 execution planı) · Est 3 · Dep T-503
- [ ] **T-505** Adversary agent + skill (Go model cheap, yapısal itiraz 
      zorunlu, kanıtsız itiraz geçersiz, sycophancy önleme) · Est 3 · Dep T-503
- [ ] **T-506** Judge agent + skill (PASS/MODIFY/DEADLOCK state machine,
      her iki argümanı değerlendirir, bağlayıcı karar) · Est 4 · Dep T-504,T-505
- [ ] **T-507** Idea orchestrator: debate loop (max 3), idea_exhausted 
      + neden özeti, DEADLOCK→Scout kısıtlarla, MODIFY→debate tekrar · Est 5 · Dep T-506
- [ ] **T-508** 'idea' job tipi dashboard form (tema opsiyonel, hedef kitle, 
      problem alanı) + navigasyon butonu · Est 2 · Dep T-501
- [ ] **T-509** Product Manager agent + skill (PRD üretimi, waiting PRD 
      onayı için dashboard review UI + onayla/düzenle/iptal) · Est 4 · Dep T-507
- [ ] **T-510** Scaffolder agent + skill (repo scaffold, feature listesi 
      jobs'a queue) + parent job decomposed · Est 4 · Dep T-509
- [ ] **T-511** Idea job timeline UI (Scout/Exec/Advocate/Adversary/Judge 
      adımları, paralel araştırma badge'i, PRD preview) · Est 3 · Dep T-508
- [ ] **M5** ✅ Fikir/tema → araştırma → kill test → tartışma → Judge PASS 
      → PRD onayı → scaffold → feature queue · Dep T-510,T-511

## Faz 6 — Hardening + dogfood · DL 2026-08-02
- [ ] **T-601** Retry/timeout/kill-switch sağlamlaştır · Est 3 · Dep M4
- [ ] **T-602** Kendi projende 1 hafta günlük kullan; bug günlüğü tut · Est 4 · Dep M3
- [ ] **T-603** Retro + sıradaki senaryo kararı (marketing/iş akışı) · Est 1 · Dep T-602
- [ ] **M6** ✅ Gerçek kullanımda stabil, dökümante, sıradaki faz seçildi

---

## Backlog (MVP dışı, sonra)
- [ ] Marketing hattı: içerik üret + onay kuyruğu (otomatik post YOK)
- [ ] İş akışı: mail/Teams triyajı, toplantı notu → görev
- [ ] Çoklu kullanıcı / ekip / ürünleştirme
- [ ] BullMQ+Redis'e kuyruk taşıma (ölçek gerekirse)
- [ ] Langfuse ile agent trace
