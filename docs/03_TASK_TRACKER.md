# 03 — Task Tracker

> Durum işaretleri: `[ ]` yapılacak · `[~]` devam · `[x]` bitti · `[!]` bloke
> Her görevi bitirince işaretle + `04_CONTEXT_TRACKER.md`'yi güncelle. Saat tahmini kayarsa **tahmini düzelt, kapsamı değil**.

## Lejant
- **ID:** T-### · **Est:** kabaca saat · **DL:** hedef bitiş · **Dep:** bağımlılık

---

## Faz 0 — Foundations · DL 2026-06-07
- [ ] **T-001** Hesaplar: GitHub App/PAT, Supabase, OpenCode Go key, Claude Pro login · Est 2 · Dep —
- [ ] **T-002** Worker VM (Fly/Railway/VPS): Node 22, git, OpenCode CLI, Claude Code CLI, Playwright kur · Est 2 · Dep T-001
- [ ] **T-003** Monorepo iskeleti (pnpm workspaces, apps/, packages/) · Est 1 · Dep —
- [ ] **T-004** Supabase şema migrate (projects, jobs, runs, usage_log, approvals) · Est 1 · Dep T-001
- [ ] **T-005** "Hello agent" scripti: clone → branch → README satırı → commit → push → PR (Octokit) · Est 2 · Dep T-002,T-004
- [ ] **M0** ✅ Elle tetiklenen script gerçek PR açıyor · Dep T-005

## Faz 1 — Control plane MVP · DL 2026-06-21
- [ ] **T-101** Next.js + Tailwind + shadcn iskelet, tek-kullanıcı auth (Supabase) · Est 3 · Dep T-003
- [ ] **T-102** GitHub App/OAuth bağla → repo listesini çek · Est 4 · Dep T-001,T-101
- [ ] **T-103** "Projeyi bağla/seç" ekranı → `projects` kaydı · Est 3 · Dep T-102,T-004
- [ ] **T-104** "New feature" formu (başlık, açıklama, branch, lane) → `POST /api/jobs` · Est 4 · Dep T-103
- [ ] **T-105** Job listesi + detay sayfası · Est 4 · Dep T-104
- [ ] **T-106** Supabase Realtime → job durumu canlı güncelleme · Est 3 · Dep T-105
- [ ] **T-107** API input validation (zod) + hata yönetimi · Est 2 · Dep T-104
- [ ] **M1** ✅ Dashboard'dan feature → DB'de queued job, listede görünüyor · Dep T-106

## Faz 2 — Execution plane (happy path) · DL 2026-06-28
- [ ] **T-201** Worker: job poll/subscribe döngüsü, `running`'e çek · Est 3 · Dep T-004
- [ ] **T-202** Git worktree yönetimi: izole klon + `feature/<slug>` aç · Est 3 · Dep T-201
- [ ] **T-203** Tek agent runner (Claude Code `claude -p` adaptörü) · Est 4 · Dep T-002,T-202
- [ ] **T-204** Commit + push + PR aç → `pr_url` yaz · Est 3 · Dep T-203
- [ ] **T-205** Hata yakalama + `failed` + log → `runs` · Est 2 · Dep T-203
- [ ] **T-206** Worktree temizliği (başarı/başarısızlık sonrası) · Est 1 · Dep T-202
- [ ] **M2** ✅ Dashboard'dan basit feature → dakikalar içinde gerçek PR linki ekranda · Dep T-204

## Faz 3 — Agent ekibi · DL 2026-07-12
- [ ] **T-301** Orchestrator iskelet: sıralı + koşullu adımlar, state machine · Est 4 · Dep T-203
- [ ] **T-302** Handoff sözleşmesi: her agent yapılandırılmış çıktı (zod şemalı) · Est 3 · Dep T-301
- [ ] **T-303** product-owner agent + skill bağla (web research) · Est 3 · Dep T-302
- [ ] **T-304** architect agent + skill (plan, API kontrat, branch) · Est 3 · Dep T-303
- [ ] **T-305** frontend + backend agent (paylaşılan api-contract) · Est 5 · Dep T-304
- [ ] **T-306** code-reviewer döngüsü (temiz olana kadar, max N tur → insana yükselt) · Est 4 · Dep T-305
- [ ] **T-307** tester döngüsü: unit + edge + Playwright E2E (pass olana kadar) · Est 5 · Dep T-306
- [ ] **T-308** OpenCode (ucuz şerit) runner adaptörü + agent-team plugin · Est 4 · Dep T-301
- [ ] **M3** ✅ Orta zorlukta feature → ekip → test → PR · Dep T-307,T-308

## Faz 4 — Router + observability + kapılar · DL 2026-07-19
- [ ] **T-401** Router: role+complexity → şerit/model seçimi (policy doc 08) · Est 4 · Dep T-308
- [ ] **T-402** `usage_log` yaz: her çağrıda model+token+tahmini maliyet · Est 3 · Dep T-401
- [ ] **T-403** Limit guardrail: eşik yaklaşınca premium kapat / ucuza düş / durdur · Est 3 · Dep T-402
- [ ] **T-404** Dashboard: canlı run adımları + log viewer · Est 4 · Dep T-106
- [ ] **T-405** Dashboard: maliyet sayacı + limit barı · Est 2 · Dep T-402
- [ ] **T-406** Onay kapıları UI: `approvals` (migration/merge) onayla/reddet · Est 3 · Dep T-105
- [ ] **M4** ✅ "Ne çalışıyor, ne kadar, neyi onaylamalıyım" tek bakışta · Dep T-405,T-406

## Faz 5 — Fikir→MVP hattı · DL 2026-07-26
- [ ] **T-501** `idea` job tipi + form · Est 2 · Dep T-104
- [ ] **T-502** Research agent'ları (pazar/rakip/pain; web+PH+Reddit MCP) · Est 5 · Dep T-501
- [ ] **T-503** PRD + MVP kapsam + tech seçim çıktısı (insan onay kapısı) · Est 3 · Dep T-502
- [ ] **T-504** Repo scaffold üret + ilk feature listesini `jobs`'a yaz · Est 4 · Dep T-503
- [ ] **M5** ✅ Fikir cümlesi → araştırma + scaffold + sıraya alınmış feature'lar · Dep T-504

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
