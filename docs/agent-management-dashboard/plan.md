# Agent Management Dashboard — Implementation Plan

## Overview

Build a comprehensive agent management dashboard for the Conductor platform. This allows users to view, configure, and manage all 8 pipeline agents from a single UI — including model selection, system prompt editing, enable/disable toggling, and real-time status monitoring.

### Current State

Agent configuration is hardcoded across 3 layers:
- **System prompts**: inline in each `apps/worker/src/agents/*.ts` file
- **Lane policy**: hardcoded `BASE_POLICY` table in `apps/worker/src/router.ts`
- **Model selection**: hardcoded `PREMIUM_MODEL` / `CHEAP_MODEL` in `runner.ts` + `router.ts`

No agent can be disabled, no config is editable from the UI, no real-time status is visible.

### Target State

- All agent config stored in Supabase (`agent_config` table)
- Provider/model catalog stored in Supabase (`provider_models` table)
- Dashboard at `/dashboard/agents` for full CRUD
- Worker reads config from DB at each job start (cache invalidated per-job)
- Real-time agent status via Supabase Realtime (3 channels)
- Disabled agents are skipped in pipeline (not blocking)
- Config changes take effect on the next job (currently running jobs unaffected)

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 App Router, React 19, TypeScript strict |
| UI | shadcn/ui, Tailwind CSS 3, custom Conductor design tokens |
| Backend API | Next.js Route Handlers (App Router) |
| Database | Supabase Postgres + Realtime |
| Worker | Node 22+ TypeScript, spawned agent CLI |
| State | Supabase Realtime (Postgres Changes via WebSocket) |
| Validation | Zod schemas in `@conductor/core` |

### Design Language

- Dark mode only (`className="dark"` on html)
- Amber accent (`--amber: #f59e0b`)
- Monospace: JetBrains Mono
- Display: Syne
- Surface colors: `--surface`, `--surface-raised`, `--surface-overlay`
- No border-radius (`--radius: 0rem`)
- Dot-grid background pattern

---

## Phase 0 — Database Foundation

### Task 0.1: Migration `005_agent_management.sql`

Create the migration file at `apps/dashboard/supabase/migrations/005_agent_management.sql`.

**Tables:**

1. `agent_config` — per-agent configuration
   - `id` uuid PK (gen_random_uuid)
   - `agent_name` text UNIQUE NOT NULL with CHECK constraint for the 8 valid agent names
   - `display_name` text NOT NULL
   - `role` text NOT NULL (human-readable role description)
   - `provider` text NOT NULL DEFAULT 'claude'
   - `model` text NOT NULL DEFAULT 'claude-sonnet-4-6'
   - `system_prompt` text NOT NULL (full prompt content)
   - `skill_path` text (nullable, path to SKILL.md file)
   - `enabled` boolean NOT NULL DEFAULT true
   - `lane_override` text nullable, CHECK in ('cheap', 'premium')
   - `order` int NOT NULL DEFAULT 0 (pipeline execution order)
   - `created_at` timestamptz DEFAULT now()
   - `updated_at` timestamptz DEFAULT now()
   - Trigger for `updated_at` auto-update

2. `provider_models` — extensible provider/model catalog
   - `id` uuid PK
   - `provider` text NOT NULL
   - `model_id` text NOT NULL
   - `display_name` text NOT NULL
   - `capabilities` jsonb DEFAULT '{}'
   - `available` boolean DEFAULT true
   - `created_at` timestamptz DEFAULT now()
   - UNIQUE(provider, model_id)

**ALTER TABLE jobs:**
- Add `current_agent` text (nullable)
- Add `current_step_message` text (nullable)

**RLS Policies:**
- Enable RLS on both new tables
- service_role full access policy on both

**Seed Data — provider_models (6 rows):**

| provider | model_id | display_name | capabilities |
|----------|----------|--------------|--------------|
| claude | claude-sonnet-4-6 | Claude Sonnet 4.6 | {"tier":"premium","context":200000} |
| claude | claude-sonnet-4-5 | Claude Sonnet 4.5 | {"tier":"premium","context":200000} |
| claude | claude-opus-4-5 | Claude Opus 4.5 | {"tier":"premium","context":200000} |
| claude | claude-haiku-3-5 | Claude Haiku 3.5 | {"tier":"cheap","context":200000} |
| opencode | opencode-go/deepseek-v4-flash | DeepSeek V4 Flash | {"tier":"cheap","context":131072} |
| opencode | opencode-go/qwen3.6-plus | Qwen 3.6 Plus | {"tier":"cheap","context":131072} |

**Seed Data — agent_config (8 rows):**

Each agent seeded with its current hardcoded values:
1. product-owner → claude, claude-sonnet-4-6, order 1
2. codebase-analyst → opencode, opencode-go/deepseek-v4-flash, order 2
3. tech-lead → claude, claude-sonnet-4-6, order 3
4. backend-dev → opencode, opencode-go/deepseek-v4-flash, order 4
5. frontend-dev → opencode, opencode-go/deepseek-v4-flash, order 5
6. security-reviewer → claude, claude-sonnet-4-6, order 6
7. code-reviewer → claude, claude-sonnet-4-6, order 7
8. qa-engineer → opencode, opencode-go/deepseek-v4-flash, order 8

System prompts in seed data should match the current inline prompts from each agent file.

### Task 0.2: Core Types — Zod Schemas

Update `packages/core/src/types.ts`:

Add the following schemas and types:

```
AgentConfigSchema → {
  id: uuid, agentName: AgentName, displayName: string, role: string,
  provider: string, model: string, systemPrompt: string,
  skillPath: string | null, enabled: boolean,
  laneOverride: 'cheap' | 'premium' | null,
  order: number, createdAt: datetime, updatedAt: datetime
}

ProviderModelSchema → {
  id: uuid, provider: string, modelId: string, displayName: string,
  capabilities: Record<string, unknown>, available: boolean
}
```

Update existing schemas:
- `JobSchema`: add `currentAgent: z.string().nullable()`, `currentStepMessage: z.string().nullable()`
- `JobRowSchema`: add `current_agent: z.string().nullable()`, `current_step_message: z.string().nullable()`

Add corresponding TypeScript types via `z.infer`.

### Task 0.3: Database Types Update

Update `apps/dashboard/lib/supabase/types.ts`:

Add entries for:
- `agent_config` table: Row, Insert, Update types
- `provider_models` table: Row, Insert, Update types

Update `jobs` table types to include new columns.

### Task 0.4: Deploy Migration

Run `pnpm db:push` (or equivalent Supabase migration command) to apply the migration.

Verify:
- Both tables exist with correct columns
- Seed data inserted correctly
- RLS policies active
- `updated_at` trigger works

---

## Phase 1 — API Layer

### Task 1.1: GET /api/agents

Create `apps/dashboard/app/api/agents/route.ts`.

Returns:
- All agent configs from `agent_config` table, ordered by `order`
- Currently running jobs: query `jobs` where `current_agent IS NOT NULL` AND `status = 'running'`
- For each running job, include: job id, title, agent name, started_at, current_step_message

Response shape:
```
{
  agents: AgentConfig[],
  runningJobs: {
    jobId: string,
    jobTitle: string,
    agentName: string,
    startedAt: string,
    stepMessage: string | null
  }[]
}
```

### Task 1.2: PUT /api/agents/[name]

Create `apps/dashboard/app/api/agents/[name]/route.ts`.

Request body (all fields optional, only provided fields updated):
```
{
  displayName?: string,
  role?: string,
  provider?: string,
  model?: string,
  systemPrompt?: string,
  skillPath?: string | null,
  laneOverride?: 'cheap' | 'premium' | null,
  order?: number
}
```

Logic:
- Validate `[name]` against AgentName enum
- Validate body with Zod
- Upsert into `agent_config` where `agent_name = name`
- Return updated config

### Task 1.3: PATCH /api/agents/[name]/toggle

Same file as 1.2 (or separate handler).

Logic:
- Flip `enabled` boolean
- Guard: if disabling the last enabled agent, reject with 400
- Return updated config

### Task 1.4: GET /api/agents/providers

Create `apps/dashboard/app/api/agents/providers/route.ts`.

Returns all providers grouped:
```
{
  providers: {
    name: string,
    displayName: string,
    models: ProviderModel[]
  }[]
}
```

Query `provider_models` table, group by provider, filter `available = true`.

---

## Phase 2 — Dashboard UI

### Task 2.1: Add "Agents" to Sidebar

Update `apps/dashboard/components/sidebar.tsx`:

Add a new nav item to the `NAV` array:
- Label: "Agents"
- Href: "/dashboard/agents"
- Icon: appropriate SVG (people/team icon in Conductor style)

### Task 2.2: Server Page Component

Create `apps/dashboard/app/dashboard/agents/page.tsx`.

Server component that:
- Fetches all agent configs from Supabase
- Fetches provider list with models
- Fetches currently running jobs
- Passes data as props to the client component

### Task 2.3: Client Component Layout

Create `apps/dashboard/app/dashboard/agents/agents-client.tsx`.

Client component with:
- Two-column layout (left: agent list, right: detail panel)
- Supabase Realtime subscriptions on 3 channels:
  1. `agent_config` table (UPDATE events → config changed)
  2. `jobs` table (UPDATE events on `current_agent` column → active agent change)
  3. `runs` table (INSERT/UPDATE events → last run info update)
- State management for:
  - Selected agent (for detail panel)
  - Dirty/unsaved changes flag
  - Running jobs list
  - Agent configs (live updates)
- Header with page title, total agents count, online count

### Task 2.4: Agent Card Component

Create `apps/dashboard/app/dashboard/agents/components/agent-card.tsx`.

Each card shows:
- Status dot (color + animation based on state)
- Agent display name
- Current model badge (provider/model)
- Running indicator: if this agent is currently working on a job, show "running: Job Title" with pulse
- Disabled indicator: grayed out, strikethrough
- Click to select → opens detail panel
- Hover effect (surface-raised background)

Status states:
- `running` → amber dot with pulse animation
- `idle` → green dot (last run was ok, not currently working)
- `error` → red dot (last run failed recently)
- `disabled` → gray dot with dashed border

### Task 2.5: Agent Detail Panel

Create `apps/dashboard/app/dashboard/agents/components/agent-detail.tsx`.

Full edit panel for selected agent with sections:

**Identity Section:**
- Agent name (read-only, monospace)
- Display name (editable input)
- Role (editable input)
- Pipeline order (editable number input)

**Model Selection Section:**
- Provider dropdown (claude / opencode / future)
- Model dropdown (cascading: changes based on selected provider)
- Lane override selector: Auto (policy) / Force Cheap / Force Premium
- Visual badge showing current model's tier (premium/cheap)

**System Prompt Section:**
- Monospace textarea
- Character count indicator
- Full prompt content editable
- Reset to default button (reverts to seed value)

**Skill File Section:**
- Text input for skill_path
- Shows current file path
- Clear button to set null

**Enabled/Disabled Toggle:**
- shadcn Switch component
- Label: "Agent Active"
- Warning if disabling last enabled agent

**Current Run Info:**
- If running: shows job title, step message, elapsed time
- If idle: shows last run result (ok/failed), time ago, job link

**Actions:**
- Save button (disabled if no changes)
- Reset button (reverts to last saved state)
- Unsaved changes indicator

### Task 2.6: Model Selector Component

Create `apps/dashboard/app/dashboard/agents/components/model-selector.tsx`.

Cascading dropdown:
- Provider select changes available models
- Model select shows only models for selected provider
- Each model shows: display name, tier badge (premium/cheap)
- Provider change auto-selects first available model

### Task 2.7: Prompt Editor Component

Create `apps/dashboard/app/dashboard/agents/components/prompt-editor.tsx`.

- Monospace textarea
- Auto-resize or fixed height with scroll
- Character/word count
- Line numbers (optional)
- Syntax: plain text (no code highlighting needed)

### Task 2.8: Agent Status Badge Component

Create `apps/dashboard/app/dashboard/agents/components/agent-status-badge.tsx`.

Reusable badge component showing:
- Dot with color + animation
- Status text (running/idle/error/disabled)
- Optional: job title link for running agents

### Task 2.9: shadcn/ui Components

Install required shadcn components:
- `Select` (provider/model dropdowns)
- `Switch` (enable/disable toggle)
- `Textarea` (system prompt editor)
- `Badge` (model tier, status)
- `Button` (save, reset, toggle)
- `Input` (display name, role, skill path)
- `Label` (form labels)
- `Sheet` or `Dialog` (provider management panel)
- `Toast` (save success/failure notifications)
- `Separator` (section dividers)

Use `npx shadcn@latest add <component>` for each.

### Task 2.10: Provider Management (Secondary Page/Sheet)

Create provider management UI at `/dashboard/agents/providers` or as a Sheet/Dialog.

Features:
- List all providers with their models
- Add new provider
- Add/remove models for a provider
- Toggle model availability
- Edit model display name and capabilities

---

## Phase 3 — Worker Integration

### Task 3.1: Agent Config Loader

Create `apps/worker/src/agentConfig.ts`.

Module that:
- Loads all agent configs from `agent_config` table at startup
- Caches in memory (Map<agentName, AgentConfig>)
- Provides `loadAgentConfig(supabase)` function
- Provides `invalidateConfigCache()` to clear cache
- Provides `getAgentConfig(agentName)` to get single config

The cache is invalidated at the start of each job (in `processJob.ts`), so config changes take effect on the next job.

### Task 3.2: Refactor Agent Files

Update each agent file in `apps/worker/src/agents/`:

- `productOwner.ts`
- `codebaseAnalyst.ts`
- `techLead.ts`
- `backend.ts`
- `frontend.ts`
- `securityReviewer.ts`
- `codeReviewer.ts`
- `tester.ts`

For each file:
- Remove hardcoded `SYSTEM_PROMPT` constant
- Accept `agentConfig` in options (or load from cache)
- Use `agentConfig.systemPrompt` instead of hardcoded
- Use `agentConfig.model` for model override
- Use `agentConfig.provider` for provider-specific logic if needed

### Task 3.3: Update Runner

Update `apps/worker/src/runner.ts`:

- Accept `agentConfig` in `AgentRunOptions`
- Use `agentConfig.model` as the model for spawning
- Use `agentConfig.systemPrompt` as the system prompt
- Resolve lane from `agentConfig.laneOverride` if set, otherwise from router

### Task 3.4: Update Router

Update `apps/worker/src/router.ts`:

- `resolveRoute()` accepts optional `agentConfig` parameter
- If `agentConfig.laneOverride` is set, use it directly (bypass BASE_POLICY)
- If no override, use existing BASE_POLICY logic
- Return the resolved lane + model

### Task 3.5: Update Orchestrator

Update `apps/worker/src/orchestrator.ts`:

For each agent step in the pipeline:
1. Load agent config from cache (or reload if invalidated)
2. Check `agentConfig.enabled` — if false, skip this agent with a warning log
3. Update `jobs.current_agent` and `jobs.current_step_message` before running
4. Pass `agentConfig` to the agent runner
5. After agent completes, clear `current_agent` if pipeline is done

Skip logic for disabled agents:
- product-owner disabled → use job description as spec summary (minimal spec)
- codebase-analyst disabled → create empty context.md with "no context available"
- tech-lead disabled → create minimal plan from spec
- backend-dev/frontend-dev disabled → skip implementation
- security-reviewer disabled → skip security check (warning logged)
- code-reviewer disabled → skip code review (warning logged)
- qa-engineer disabled → skip testing, proceed to commit/PR

### Task 3.6: Update ProcessJob

Update `apps/worker/src/processJob.ts`:

- Call `invalidateConfigCache()` at the start of each job
- Clear `current_agent` and `current_step_message` when job completes (in finally block)

---

## Phase 4 — Real-Time Polish

### Task 4.1: Live Agent Status

Ensure the 3 Realtime channels in `agents-client.tsx` properly update:
- Agent card status dots change color in real-time
- Running job info updates live
- Last run info updates when a run completes

### Task 4.2: Running Job Link

When an agent is running, the status badge should be a clickable link to the job detail page (`/dashboard/jobs/[id]`).

### Task 4.3: Unsaved Changes Warning

- Track dirty state in the detail panel
- Show visual indicator (dot or text) when there are unsaved changes
- Browser `beforeunload` warning if navigating away with unsaved changes
- Disable navigation to other pages until saved or discarded

### Task 4.4: Toast Notifications

Use shadcn/sonner for:
- Success toast on config save
- Error toast on save failure
- Warning toast on validation errors

### Task 4.5: Last Run Info in Detail Panel

When viewing an agent's detail:
- Query the `runs` table for the most recent run by this agent
- Show: status (ok/failed/started), time ago, job title (linkable)
- Update in real-time via the runs channel subscription

---

## Phase 5 — Edge Cases & Validation

### Task 5.1: Pipeline Validation

- At least 1 agent must be enabled (guard in toggle API)
- If all agents disabled → pipeline cannot run → show warning on dashboard

### Task 5.2: Config Change Propagation

- Worker reloads config at each job start (already handled by invalidate)
- Currently running jobs are NOT affected by config changes
- Show info message in UI: "Changes will take effect on the next job"

### Task 5.3: Model Availability Validation

- When selecting a model, verify it exists in `provider_models` table
- If a model is marked `available = false`, it cannot be selected
- If a model is removed from DB while an agent uses it, show warning

### Task 5.4: System Prompt Validation

- System prompt must not be empty (min length check)
- Show warning if prompt is very short (< 50 chars)

### Task 5.5: E2E Tests

Add Playwright E2E tests for:
- Navigate to /dashboard/agents
- View all 8 agents
- Toggle agent enabled/disabled
- Change model selection and save
- Edit system prompt and save
- Verify real-time status updates

---

## File Tree (New/Modified)

```
conductor/
├── apps/
│   ├── dashboard/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   └── agents/
│   │   │   │       ├── route.ts                    [NEW] GET all agents
│   │   │   │       ├── [name]/
│   │   │   │       │   └── route.ts                [NEW] PUT/PATCH agent
│   │   │   │       └── providers/
│   │   │   │           └── route.ts                [NEW] GET providers
│   │   │   └── dashboard/
│   │   │       └── agents/
│   │   │           ├── page.tsx                    [NEW] server component
│   │   │           ├── agents-client.tsx           [NEW] client component
│   │   │           └── components/
│   │   │               ├── agent-card.tsx          [NEW]
│   │   │               ├── agent-detail.tsx        [NEW]
│   │   │               ├── model-selector.tsx      [NEW]
│   │   │               ├── prompt-editor.tsx       [NEW]
│   │   │               └── agent-status-badge.tsx  [NEW]
│   │   ├── components/
│   │   │   └── sidebar.tsx                         [MOD] add Agents nav
│   │   ├── lib/
│   │   │   └── supabase/
│   │   │       └── types.ts                        [MOD] add new tables
│   │   └── supabase/
│   │       └── migrations/
│   │           └── 005_agent_management.sql        [NEW]
│   └── worker/
│       └── src/
│           ├── agentConfig.ts                      [NEW] config loader
│           ├── runner.ts                           [MOD] accept agentConfig
│           ├── router.ts                           [MOD] laneOverride support
│           ├── orchestrator.ts                     [MOD] config-based agents
│           ├── processJob.ts                       [MOD] invalidate cache
│           └── agents/
│               ├── productOwner.ts                 [MOD] use config
│               ├── codebaseAnalyst.ts              [MOD] use config
│               ├── techLead.ts                     [MOD] use config
│               ├── backend.ts                      [MOD] use config
│               ├── frontend.ts                     [MOD] use config
│               ├── securityReviewer.ts             [MOD] use config
│               ├── codeReviewer.ts                 [MOD] use config
│               └── tester.ts                       [MOD] use config
├── packages/
│   └── core/
│       └── src/
│           └── types.ts                            [MOD] add schemas
└── docs/
    └── agent-management-dashboard/
        ├── plan.md                                 [NEW] this file
        └── prompts.md                              [NEW] antigravity prompts
```

---

## Dependencies

New shadcn components to install:
- select, switch, textarea, badge, button, input, label, sheet/dialog, toast/sonner, separator

No new npm packages beyond what shadcn requires.

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Worker doesn't pick up config changes | invalidateConfigCache() called at each job start |
| Disabled agent breaks pipeline | Skip logic with warning logs for each agent |
| Realtime subscription overload | Separate channels, cleanup on unmount |
| System prompt too large for UI | TEXT column supports 1GB, textarea handles scroll |
| Model removed while agent uses it | Validation on save, warning on load |
| All agents disabled | Guard in toggle API, warning in UI |

---

## Definition of Done

- [ ] Migration applied and verified
- [ ] All API endpoints return correct data
- [ ] Dashboard page renders all 8 agents with correct status
- [ ] Model selection works (provider → model cascade)
- [ ] System prompt can be edited and saved
- [ ] Enable/disable toggle works (with guard)
- [ ] Real-time status updates visible
- [ ] Worker uses config from DB (not hardcoded)
- [ ] Disabled agents are skipped in pipeline
- [ ] Config changes take effect on next job
- [ ] `pnpm lint` passes
- [ ] `pnpm typecheck` passes
- [ ] E2E tests pass
