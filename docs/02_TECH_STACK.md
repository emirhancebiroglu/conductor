# 02 — Tech Stack

> İlke: **olgun, az bakım, ucuz, tek dil (TypeScript).** Egzotik bir şey seçip bakımını sırtlanma. Her satır bir gerekçeyle.

## Özet tablo

| Katman | Seçim | Neden | Alternatif (gerekirse) |
|--------|-------|-------|------------------------|
| Dil | **TypeScript** (strict) | Tek dil, FE+BE+worker hepsi | — |
| Dashboard | **Next.js 15 (App Router)** | FE + API tek repoda, Vercel kolay | Remix, SvelteKit |
| UI | **Tailwind + shadcn/ui** | Hızlı, 2026 standardı, a11y hazır | Mantine |
| DB/Auth/Realtime | **Supabase (Postgres)** | Managed; auth+realtime+storage tek yerde | Neon + Clerk |
| Worker | **Node 22+ TS servisi** | Agent CLI'larını shell'den sürer | Bun |
| Kuyruk (v1) | **Supabase tablosu poll/Realtime** | Sıfır ekstra altyapı | BullMQ+Redis (ölçekte) |
| Agent — ucuz | **OpenCode (headless) + OpenCode Go** | Açık modeller, sabit $10/ay | DeepSeek/GLM API doğrudan |
| Agent — premium | **Claude Code (headless, Pro)** | En iyi kodlama, agent teams | Cursor/Codex CLI |
| Git/PR | **Octokit + GitHub App** | PR aç, webhook, fine-grained perm | gh CLI |
| Test (unit) | **Vitest** | Hızlı, TS-native | Jest |
| Test (E2E) | **Playwright** | 2026 standardı, MCP'si var | Cypress |
| Lint/format | **ESLint + Prettier** | Tartışmasız | Biome |
| Hosting (dashboard) | **Vercel** | Next.js için sıfır konfig | Netlify |
| Hosting (worker) | **Fly.io / Railway / VPS** | Uzun ömürlü süreç + shell gerekli | kendi VPS |
| Validation | **Zod** | Runtime + tip; API/agent çıktısı doğrula | — |
| Observability | **Supabase `usage_log` + basit panel; Sentry (ops.)** | Maliyet/limit görünürlüğü | Langfuse (agent trace) |

## Neden serverless worker DEĞİL
OpenCode/Claude Code, repo checkout + kalıcı shell + dakikalarca süren işler ister. Serverless fonksiyonların süre/zaman limiti ve dosya sistemi geçiciliği buna uymaz. Worker uzun ömürlü bir süreç olmalı. Dashboard serverless kalabilir.

## Repo yapısı (monorepo, pnpm workspaces)
```
conductor/
├── apps/
│   ├── dashboard/        # Next.js (control plane)
│   └── worker/           # Node servisi (execution plane)
├── packages/
│   ├── core/             # ortak tipler, zod şemaları, job state machine
│   ├── agents/           # orchestrator + router + agent runner adaptörleri
│   └── github/           # Octokit sarmalayıcı (PR, branch, webhook)
├── skills/               # agent SKILL.md'leri (worker bunları kullanır)
├── docs/                 # bu planlama dosyaları
├── CLAUDE.md
└── package.json
```

## Sürüm/uyum notları (2026)
- Node **22+** (worker + Playwright için).
- OpenCode Go: OpenAI-uyumlu endpoint → herhangi bir agent/SDK'dan çağrılabilir. Modeller değişebilir (GLM/Kimi/MiniMax/Qwen/DeepSeek ailesi); model adlarını `opencode models` ile **runtime'da doğrula**, koda gömme.
- Claude Code: headless mod `claude -p`; Pro login (API key DEĞİL, abonelik oturumu).
- Model adlarını config'e koy, koda sabitleme — sık değişiyor.

## Kurulum sırası (Faz 0)
1. `pnpm` + monorepo iskelet.
2. Supabase projesi + şema (doc 01).
3. Next.js dashboard iskeleti (boş sayfalar).
4. Worker iskeleti (job poll döngüsü, henüz agent yok).
5. GitHub App kaydı + Octokit "PR aç" smoke test.
6. OpenCode + Claude Code CLI'larını worker VM'ine kur, `--version` doğrula.
