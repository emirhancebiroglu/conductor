# CM-Pipeline — Checkmarx Auto-Scan & Auto-Fix Pipeline

> **Status:** Planning · **Branch:** `feature/cm-pipeline` · **Owner:** Emirhan
> **Source of truth:** this file. Tasks → [tasks.md](./tasks.md). Agent prompts → [prompts.md](./prompts.md).

---

## 1. What we are building

An end-to-end, **UI-managed**, scheduled pipeline that:

1. **Discovers** GitHub repos matching a configurable filter (default: name starts with `ms` **AND** `.github/checkmarx_scan.yml` exists) and registers them for CM processing.
2. **Schedules** Checkmarx scans (default nightly @ 00:00, cron-configurable per pipeline), runs them sequentially, persists scan status.
3. **Fixes** `CRITICAL`/`HIGH` findings via an AI agent layer:
   - **SCA team** → dependency upgrades (skip MINOR tests, test MID/MAJOR).
   - **SAST team** → code fixes (e.g. SQLi, XSS) with before/after behavior verification.
4. **Re-scans** to confirm findings are resolved; on pass, pushes fixes to branch `checkmarx-auto` and **opens a PR** (human merges — never auto-merge).
5. **Reports**: generates a `.docx` report per repo, saves to disk, cleans up the temp checkout.

**Non-negotiable** (from `CLAUDE.md`): never auto-merge to main; never run destructive flags on prod repos; never commit/log secrets; human gate at PR.

### Design decisions (locked with stakeholder)

| Topic | Decision |
|---|---|
| Checkmarx access | **Real Checkmarx One CLI** is the production scan provider, behind a `ScanProvider` adapter. A **fixture mock provider** runs in dev + tests so the whole pipeline is testable without a live tenant. |
| Worker | **CM-only standalone worker** (`apps/cm-worker`), long-running Node 22 service, using **pg-boss** (Postgres-backed queue + cron) on the existing Supabase DB. Decoupled from the (stubbed) feature pipeline; shared infra extracted to `packages/*` where clean. |
| Agent runner | AI fix agents are **dynamic via `agent_config`** (same model as feature pipeline): each CM agent role picks its provider/model from DB. Execution goes through an `AgentRunner` adapter; real runner = Claude Code headless / OpenCode (per agent_config), stub runner for tests. |
| Scope v1 | **Full vertical slice**, all 5 stages, externals (Checkmarx + agent LLM) mocked in tests, real impls wired and default in prod. |
| Schedule | **Per-pipeline** cron + enable toggle + severity thresholds + **Run now**, all editable from UI, stored in DB. |
| Discovery | **Configurable filter**, defaults to the diagram rule (`ms*` + `.github/checkmarx_scan.yml`), plus manual add/remove. |

---

## 2. How it maps onto the existing system

Conductor today: a built **control plane** (Next.js dashboard + Supabase: `jobs`, `runs`, `usage_log`, `approvals`, `agent_config`, `agent_categories`, `provider_models`, `workspaces`) and a **stubbed execution plane** (`packages/agents` orchestrator/router are `throw`-stubs; no worker process exists yet).

CM-pipeline reuses, does **not** fork:

- **`agent_config` / `provider_models`** → CM agents (`cm-sca-agent`, `cm-sast-agent`) are rows here, model-selectable from the existing Agents UI. We extend the `agent_name` CHECK to allow them (or relax to slug — see §6).
- **`runs` + `usage_log`** → every CM agent step writes a `run` and its cost, so the existing Costs UI works unchanged.
- **`@conductor/github`** → branch/PR/file helpers already exist (`createBranch`, `createPR`, `getFileContent`). We add `cloneRepo` (local git) + `listRepos` for discovery.
- **`@conductor/core`** → add zod schemas + a CM state machine alongside the existing job state machine.
- **Dashboard** → new `/dashboard/cm` section (sidebar entry), reusing shadcn/ui components and the workspace-scoping pattern (`resolveWorkspaceId`).
- **Supabase Realtime** → live scan/fix status in the UI, same pattern as jobs.

What is genuinely new: the **scan/fix domain tables**, the **cm-worker process**, the **ScanProvider/AgentRunner adapters**, the **docx reporter**.

---

## 3. Architecture

```
┌───────────────────────── CONTROL PLANE (Next.js + Supabase) ─────────────────────────┐
│  /dashboard/cm                                                                         │
│   - Pipelines: cron, enable, severity thresholds, discovery filter, "Run now"          │
│   - Repos: discovered + manually-added, priority, enable/disable                       │
│   - Runs: live scan/fix status (Realtime), findings table, agent steps, cost           │
│   - Reports: download generated .docx                                                   │
│  API routes: CRUD over cm_* tables + manual trigger (enqueue), all workspace-scoped     │
└───────────────┬───────────────────────────────────────────────────────────────────────┘
                │  enqueue / read status (Supabase Postgres = single source of truth)
                ▼
┌───────────────────────── EXECUTION PLANE (apps/cm-worker, Node 22) ───────────────────┐
│  pg-boss (Postgres): cron schedules + work queues + retry/cooldown + dead-letter        │
│                                                                                         │
│  STAGE 2  scan-scheduler  → build priority queue → enqueue cm.scan jobs (sequential)    │
│  STAGE 2  cm.scan         → ScanProvider.scan(repo) → persist cm_scan + cm_findings      │
│                              system-fail → retry queue (cooldown). done → if findings,   │
│                              enqueue cm.fix                                              │
│  STAGE 3  cm.fix          → clone repo → temp worktree → verify "project runs"           │
│                              (run-config; halt→notify UI→await input) → fetch CRIT/HIGH  │
│  STAGE 4  agents          → route by source: deps→SCA agent, code→SAST agent            │
│                              (AgentRunner, model from agent_config) → apply fix → test   │
│  STAGE 3  rescan          → ScanProvider.scan again → pass? → push `checkmarx-auto` + PR │
│  STAGE 5  report+cleanup  → docx report → save to disk → remove temp worktree           │
│                                                                                         │
│  Adapters (swap real/mock by env): ScanProvider, AgentRunner, GitOps, Reporter          │
└───────────────────────────────────────────────────────────────────────────────────────┘
                │
                ▼
        GitHub: branch `checkmarx-auto` + PR  →  ⛔ HUMAN GATE (you merge)
        Disk:   D:/checkmarx-reports/{repo}-cm-{timestamp}.docx
```

### Why a standalone worker + pg-boss
- The flow clones repos, runs scans, runs LLM agents, runs tests — **minutes-long, stateful, shell-bound** work. Serverless can't (timeouts, ephemeral FS). Long-running worker is mandatory (matches `docs/02_TECH_STACK.md`).
- **pg-boss** gives cron, durable queues, retries w/ backoff, and dead-letter **on the Postgres we already run** — zero new infra (no Redis). Validated by 2026 best-practice research for Supabase/Postgres shops.

---

## 4. Data model (new `cm_*` tables)

New migration `apps/dashboard/supabase/migrations/008_cm_pipeline.sql` (+ mirror in `supabase/migrations/`). All tables: `workspace_id` FK + RLS service-role policy + `updated_at` trigger, matching existing conventions.

```sql
-- A configurable pipeline (one per workspace in v1, but modelled as a table for future multi-pipeline)
create table cm_pipeline (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null default 'Checkmarx Pipeline',
  enabled boolean not null default false,
  cron text not null default '0 0 * * *',              -- nightly 00:00
  -- discovery
  discovery_name_prefix text not null default 'ms',
  discovery_config_path text not null default '.github/checkmarx_scan.yml',
  -- gates
  severity_threshold text[] not null default '{CRITICAL,HIGH}',
  sca_test_policy text not null default 'skip-minor',  -- skip-minor | test-all
  -- behavior
  fix_branch text not null default 'checkmarx-auto',
  report_dir text not null default 'D:/checkmarx-reports',
  retry_cooldown_seconds int not null default 1800,
  max_fix_attempts int not null default 2,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Repos registered for processing (auto-discovered or manual)
create table cm_repo (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references cm_pipeline(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  owner text not null,
  name text not null,
  default_branch text not null default 'main',
  source text not null default 'auto',                 -- auto | manual
  priority int not null default 100,                   -- lower = front of queue
  enabled boolean not null default true,
  run_config jsonb,                                     -- profile, mvn/npm cmd, jdk, etc.
  last_scan_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (pipeline_id, owner, name)
);

-- One scan execution
create table cm_scan (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references cm_repo(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  status text not null default 'queued',               -- see state machine §5
  provider text not null default 'checkmarx',
  external_scan_id text,                                -- Checkmarx scan id
  branch_scanned text,
  trigger text not null default 'schedule',            -- schedule | manual | retry
  findings_total int default 0,
  findings_actionable int default 0,                   -- CRIT/HIGH after filter
  error text,
  current_step text,                                   -- live UI message
  pr_url text,
  report_path text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Individual findings (SCA or SAST)
create table cm_finding (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references cm_scan(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null,                                -- sca | sast
  severity text not null,                              -- CRITICAL | HIGH | MEDIUM | LOW
  rule text,                                           -- e.g. "SQL Injection", CVE id
  package text,                                        -- SCA: pkg name
  current_version text,                                -- SCA
  fixed_version text,                                  -- SCA: target
  upgrade_impact text,                                 -- MINOR | MID | MAJOR (SCA)
  file text,                                           -- SAST
  line int,                                            -- SAST
  fingerprint text not null,                           -- stable id for dedup across rescans
  fix_status text not null default 'open',             -- open | fixing | fixed | skipped | failed | verified
  fix_attempts int not null default 0,
  fix_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (scan_id, fingerprint)
);

-- Generated report artifacts
create table cm_report (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references cm_scan(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  path text not null,
  format text not null default 'docx',
  created_at timestamptz default now()
);
```

**Reuse for agent steps/cost:** CM agent executions write to the existing `runs` table (`job_id` nullable or a CM-scoped variant — see §6 open item) and `usage_log`, so the Costs UI is free. Decision in §6.

---

## 5. State machines

### Scan status (`cm_scan.status`)
```
queued → scanning → scan_done
                 ↘ scan_failed → (retry after cooldown) → queued
scan_done → (no actionable findings) → reporting → done
scan_done → (findings) → fixing
fixing → run_blocked        (project won't start; await user run-config) → fixing
fixing → fixed → rescanning
rescanning → scan_done (loop, bounded by max_fix_attempts)
rescanning → verified → pr_opening → pr_opened → reporting → done
fixing/rescanning → needs_human   (exhausted attempts / unresolved)
any → failed (system error after retries exhausted → dead-letter)
```

### Finding fix status (`cm_finding.fix_status`)
```
open → fixing → fixed → (rescan) → verified
open → skipped         (e.g. SCA MINOR under skip policy, no test)
fixing → failed        (fix didn't apply / test regressed) → retry up to max → needs_human
```

Both encoded in `packages/cm-core` with `canTransition()` guards (mirrors existing `job-states.ts`).

**Idempotency** (research-backed): every queue handler is idempotent — keyed on `scan_id`/`finding.fingerprint`, uses upserts not blind inserts, so a retried job leaves state identical. pg-boss at-least-once delivery is safe.

---

## 6. Open implementation decisions (resolved in plan, flagged for review)

1. **`runs.job_id` for CM steps.** `runs` currently FKs `jobs`. Options: (a) make `runs.job_id` nullable + add `runs.scan_id`; (b) create `cm_run`. **Decision:** (a) — add nullable `scan_id uuid references cm_scan(id)`, keep one cost/observability surface. Migration handles it; types widen.
2. **`agent_config.agent_name` CHECK.** Currently a hard CHECK of 8 names. CM needs `cm-sca-agent`, `cm-sast-agent`. **Decision:** drop the CHECK, rely on `AgentSlugSchema` (already widened in `types.ts` — code is ready, only the DB CHECK lags). Migration drops constraint; seed two CM agent rows.
3. **Checkmarx auth.** cx CLI needs base-uri + tenant + API key. **Decision:** worker env vars (`CX_BASE_URI`, `CX_TENANT`, `CX_APIKEY`), never in DB, never logged. `.env.example` documents them; mock provider needs none.
4. **"Project runs" gate.** Diagram halts pipeline until project starts locally. **Decision:** v1 = best-effort run-config from `cm_repo.run_config`; if missing/failing, set scan `run_blocked`, surface in UI, await user-supplied config (reuses existing `waiting_input` UX pattern). Don't block the whole worker — only that repo's job.

---

## 7. Package / file layout

```
packages/
  cm-core/                     # NEW: zod schemas, state machines, finding fingerprint, types
    src/
      types.ts                 # CmPipeline, CmRepo, CmScan, CmFinding, CmReport (+ Row variants)
      scan-states.ts           # state machine + canTransition
      fingerprint.ts           # stable finding id
      index.ts
  cm-adapters/                 # NEW: provider interfaces + real + mock impls
    src/
      scan-provider.ts         # interface ScanProvider { scan(), fetchResults() }
      checkmarx-cli.ts         # real cx CLI impl (execa)
      mock-scan-provider.ts    # fixture JSON impl (tests/dev)
      agent-runner.ts          # interface AgentRunner { run(agentConfig, task) }
      claude-runner.ts         # real (claude -p) / opencode by provider
      stub-runner.ts           # deterministic test impl
      reporter.ts              # docx report (docx lib)
      git-ops.ts               # clone/worktree/commit/push (simple-git/execa)
      index.ts
  github/                      # EXTEND: add cloneRepo, listRepos (discovery)

apps/
  cm-worker/                   # NEW: long-running Node service
    src/
      index.ts                 # boot pg-boss, register cron + handlers, graceful shutdown
      handlers/
        scheduler.ts           # build priority queue, enqueue scans
        scan.ts                # run scan, persist findings
        fix.ts                 # clone, run-gate, fetch findings, dispatch agents
        rescan.ts              # rescan + verify + push + PR
        report.ts              # docx + cleanup
      pipeline/
        sca.ts                 # SCA team logic (upgrade impact, test policy)
        sast.ts                # SAST team logic (apply fix, before/after test)
      db.ts                    # supabase service-role client
      config.ts                # env, adapter selection (real vs mock)
    package.json

apps/dashboard/
  app/dashboard/cm/            # NEW UI section (pipelines, repos, runs, reports)
  app/api/cm/                  # NEW API routes (CRUD + manual trigger)
  supabase/migrations/008_cm_pipeline.sql
```

---

## 8. UI (dynamic, UI-managed — the explicit requirement)

New sidebar entry **“Checkmarx”** → `/dashboard/cm`:

- **Pipeline settings** (form): enable toggle, cron (with human-readable preview + validation), severity thresholds (multi-select), SCA test policy, discovery filter (prefix + config path), fix branch, report dir, cooldown, max attempts. Saves to `cm_pipeline`.
- **Repos tab**: list discovered + manual repos; “Discover now” (runs filter against GitHub), add/remove manual, set priority, enable/disable, edit `run_config`.
- **Runs tab**: live (Realtime) list of scans with status, current step, findings counts; drill-in shows findings table (severity, source, fix_status), agent steps (from `runs`), cost (from `usage_log`), PR link, report download.
- **“Run now”** button → POST enqueues a manual scan job.

All workspace-scoped via existing `resolveWorkspaceId`. Reuses shadcn/ui + the agents-dashboard patterns. Model selection for `cm-sca-agent`/`cm-sast-agent` happens in the **existing Agents page** (they appear as agents), satisfying “pick which agents use which models.”

---

## 9. Testing strategy (test every layer — robustness requirement)

| Layer | Test type | What |
|---|---|---|
| `cm-core` state machines, fingerprint | unit (vitest) | every legal/illegal transition; fingerprint stability across rescans |
| zod schemas | unit | parse real-shaped Checkmarx JSON fixtures (SCA + SAST) |
| `MockScanProvider` | unit | returns deterministic findings from fixtures |
| `ScanProvider` real (checkmarx-cli) | unit w/ mocked execa | builds correct cx args, parses `--report-format json`, maps severities; **no live tenant in CI** |
| SCA logic | unit | semver impact labelling (MINOR/MID/MAJOR), skip-minor policy, target-version selection |
| SAST logic | unit | before/after behavior gate (regression = reject fix) |
| `StubRunner` | unit | deterministic edit; AgentRunner contract honored |
| reporter | unit | docx generated, opens, contains repo/findings/fixes/status sections |
| git-ops | unit w/ temp repo | clone→branch→commit→push (against a local bare repo) |
| worker handlers | integration | drive each handler against a test Supabase schema + mock adapters; assert state transitions + DB rows + idempotency (run twice = same state) |
| full pipeline | integration | one mocked scan with 1 SCA + 1 SAST finding → fix → rescan(clean) → PR(mock) → report; assert `verified`/`done` |
| API routes | unit | auth, workspace scoping, zod validation, CRUD |
| UI | Playwright E2E | pipeline settings save/persist; discover repos; run-now enqueues; runs list renders; report download link present (matches existing E2E style) |

**Per-task gate:** each task in [tasks.md](./tasks.md) lists its own test + a “done when green” check. Nothing proceeds on red. `pnpm lint && pnpm test && pnpm test:e2e` green before PR (CLAUDE.md DoD).

---

## 10. Security & guardrails (CLAUDE.md absolutes)

- **No auto-merge.** Pipeline ends at PR on `checkmarx-auto`. Human merges.
- **No `--dangerously-skip-permissions`** on real repos; agent runs sandboxed in the temp worktree only.
- **Secrets** (`CX_APIKEY`, GitHub token, Supabase service key) only in worker env; never DB, never logged, never in reports. `.gitignore` covers `.env*`. Reporter + loggers redact.
- **Dependency upgrades & code fixes are changes, not deploys** — they land in a PR. MID/MAJOR upgrades always tested; SAST fixes always behavior-verified before commit.
- **Destructive scope:** worker clones to a temp dir it owns; cleanup removes only that dir. Never touches the user's other files.
- **Workspace isolation:** every query scoped by `workspace_id`; RLS service-role policy mirrors existing tables.

---

## 11. Sequencing (phases → see tasks.md for atomic tasks)

- **P0 Foundations:** schema migration + `cm-core` types/state machines + fixtures. (testable in isolation)
- **P1 Adapters:** ScanProvider (mock+real), AgentRunner (stub+real), git-ops, reporter. (unit-tested, no worker yet)
- **P2 Worker happy path:** pg-boss boot + scan handler + scheduler with **mock** provider → findings persisted. (integration)
- **P3 Fix + agents:** clone/run-gate, SCA + SAST logic, agent dispatch via `agent_config`, rescan/verify. (integration)
- **P4 PR + report + cleanup:** push branch, open PR (mock in test/real in prod), docx, cleanup. (integration)
- **P5 Dashboard UI:** API routes + `/dashboard/cm` pages + Realtime + Agents-page CM agents. (E2E)
- **P6 Real wiring + hardening:** real Checkmarx CLI + real agent runner behind env flag; retry/cooldown/dead-letter; dogfood on one `ms*` repo; docs.

Each phase ends green and independently demonstrable. Real externals stay behind adapters until P6, so P0–P5 run fully in CI with mocks.

---

## 12. Out of scope (v1, deliberately deferred)
- Multiple pipelines per workspace (schema supports it; UI shows one).
- Branch-selection beyond “latest updated branch” (diagram note: comes later).
- Auto-merge / deploy (never — human gate).
- Non-docx report formats; report emailing.
- Container/IaC scan sources (only SCA + SAST in v1).
