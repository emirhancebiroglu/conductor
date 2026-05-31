# Agent Management Dashboard — Comprehensive Test Plan

## Testing Philosophy

Every prompt from the original plan was implemented. The pipeline now spans DB → API → Dashboard → Worker. A single regression can break the chain silently. This plan covers every contract, every state, and every failure mode across all layers.

Tests are written **before the code does not exist — they are written now as the validation layer**. The test suite must be:

- **Deterministic** — same seed data, same results every run
- **Isolated** — no test depends on another test's side effects
- **Fast** — unit/integration < 30s, E2E < 2min
- **CI-ready** — zero external state (Supabase mocked, worker not spawned)
- **Comprehensive** — happy path, validation, edge cases, real-time, concurrent access

---

## Test Pyramid

```
        ⬆ Playwright E2E (8 scenarios, 4 MCP component-level)
       ⬆⬆ Integration: API + FE data flow (12 scenarios)
      ⬆⬆⬆ Frontend Unit: component logic (35 scenarios)
     ⬆⬆⬆⬆ Backend Unit: schemas, cache, router, orchestrator (40 scenarios)
    ⬆⬆⬆⬆⬆ DB / Migration: column presence, constraints, triggers, RLS (20 scenarios)
```

---

## Layer 1: Database & Migration Tests

### 1.1 Migration Structure
- `005_agent_management.sql` creates exactly 2 tables, alters exactly 1 table
- Column count, name, type, nullability, default per table
- `updated_at` trigger exists and fires on UPDATE
- CHECK constraint on `agent_config.agent_name` validates 8 agents
- UNIQUE constraint on `provider_models(provider, model_id)`
- RLS enabled on both tables; service_role policy exists

### 1.2 Seed Data Verification
- `provider_models` has exactly 6 rows
- `agent_config` has exactly 8 rows, each with valid agent_name
- Each agent_config.system_prompt is non-empty and matches source agent files
- `product-owner` has `lane_override = NULL`, `order = 1`
- `qa-engineer` has `order = 8`

### 1.3 Jobs Table Extension
- `current_agent` column exists, nullable, type text
- `current_step_message` column exists, nullable, type text

### 1.4 Constraint Enforcement
- INSERT invalid agent_name → CHECK constraint violation
- INSERT duplicate (provider, model_id) → UNIQUE violation
- DELETE from provider_models while agent references it → FK violation (or no FK — confirm design)

---

## Layer 2: Backend Unit Tests (Vitest)

### 2.1 Schema Validation (`packages/core/src/types.ts`)

| Scenario | Input | Expected |
|----------|-------|----------|
| Valid AgentConfigSchema | Full valid object | Parse succeeds |
| Missing `agentName` | Omit field | Parse fails |
| Invalid `agentName` enum | `"invalid-agent"` | Parse fails |
| Valid `laneOverride` values | `"cheap"`, `"premium"`, `null` | Parse succeeds |
| Invalid `laneOverride` | `"ultra-premium"` | Parse fails |
| ProviderModelSchema valid | Full valid object | Parse succeeds |
| JobSchema with new fields | `currentAgent: null` | Parse succeeds |
| JobSchema with new fields | `currentAgent: "product-owner"` | Parse succeeds |
| JobRowSchema current_agent | `current_agent: null` | Parse succeeds |
| JobRowSchema current_step_message | `current_step_message: "Building"` | Parse succeeds |

### 2.2 Agent Config Loader (`apps/worker/src/agentConfig.ts`)

| Scenario | Setup | Expected |
|----------|-------|----------|
| `loadAgentConfig` loads all 8 | Mock supabase returns 8 rows | Map has 8 entries |
| `getAgentConfig` by name | Config loaded | Returns correct config |
| `getAgentConfig` not found | Name not in cache | Returns `null` |
| `invalidateConfigCache` clears | After load, call invalidate | Cache is empty |
| `loadAgentConfig` handles error | Supabase throws | Returns empty map, logs warning |
| `loadAgentConfig` empty result | Supabase returns 0 rows | Returns empty map |
| Concurrent cache access | Multiple reads during load | No race condition |
| `agentConfig.model` fallback | Config has `model=null` | Should not happen — schema enforces |

### 2.3 Router Lane Override (`apps/worker/src/router.ts`)

| Scenario | agentConfig | Expected Lane |
|----------|-------------|---------------|
| No override, cheap agent | `{ laneOverride: null }` | Follows BASE_POLICY |
| Override cheap | `{ laneOverride: "cheap" }` | Always cheap |
| Override premium | `{ laneOverride: "premium" }` | Always premium |
| Override + cost limit exceeded | Premium override, hard limit hit | Cost check still enforced |
| No config at all | `undefined` | Legacy BASE_POLICY path |

### 2.4 Orchestrator Skip Logic (`apps/worker/src/orchestrator.ts`)

| Scenario | Disabled Agent | Expected Behavior |
|----------|---------------|-------------------|
| product-owner disabled | enabled=false | Uses description as spec, logs warning |
| codebase-analyst disabled | enabled=false | Creates empty context.md |
| tech-lead disabled | enabled=false | Creates minimal plan |
| backend-dev disabled | enabled=false | Skips impl step entirely |
| frontend-dev disabled | enabled=false | Skips impl step entirely |
| security-reviewer disabled | enabled=false | Logs warning, skips |
| code-reviewer disabled | enabled=false | Logs warning, skips |
| qa-engineer disabled | enabled=false | Proceeds to commit/PR without tests |
| All agents enabled | all=true | Full pipeline runs normally |

### 2.5 ProcessJob Cache Lifecycle

| Scenario | Expected |
|----------|----------|
| `invalidateConfigCache()` called at start | Cache cleared before pipeline |
| `current_agent` cleared in finally block | Even on error |
| `current_step_message` cleared in finally block | Even on error |

### 2.6 Agent File Refactoring (8 agents)

| Scenario | Expected |
|----------|----------|
| Each agent accepts optional `agentConfig` | TypeScript compiles |
| `agentConfig.systemPrompt` used when provided | Prompt matches config |
| No config provided | Uses hardcoded prompt (backward compat) |
| `agentConfig.model` passed to runner | Model override applies |

---

## Layer 3: Frontend Unit Tests (Vitest)

### 3.1 Agent Status Badge

| Scenario | Status Prop | Expected |
|----------|-------------|----------|
| Running status | `"running"` | Amber dot with pulse class |
| Idle status | `"idle"` | Green dot, no animation |
| Error status | `"error"` | Red dot |
| Disabled status | `"disabled"` | Gray dot, dashed border |
| Running with job title | `"running"`, `jobTitle="My Job"` | Link to `/dashboard/jobs/:id` |
| Status text displayed | Any status | Text matches status label |

### 3.2 Model Selector Cascade

| Scenario | Setup | Expected |
|----------|-------|----------|
| Provider change triggers model filter | Select "claude" | Only Claude models shown |
| No models for provider | Select unknown provider | Empty model list, disabled dropdown |
| Auto-select first model | Change provider | First model auto-selected |
| Tier badge rendered | Model has capabilities.tier | "premium" or "cheap" badge visible |

### 3.3 Prompt Editor

| Scenario | Input | Expected |
|----------|-------|----------|
| Character count updates | Type 10 chars | Shows "10" count |
| Warning on short prompt | Type 3 chars | Warning icon/text appears |
| Warning threshold (50) | Type 49 chars | Warning visible |
| No warning at 50+ | Type 50 chars | Warning hidden |
| Auto-resize or scroll | Paste 5000 chars | Content visible via scroll |

### 3.4 Agent Detail Dirty State

| Scenario | Action | Expected |
|----------|--------|----------|
| No changes | Open detail | Save disabled, dirty=false |
| Change display name | Edit input | Save enabled, dirty=true |
| Reset after change | Click reset | Reverts to original, dirty=false |
| Save success | Save completes | dirty=false, success toast |
| Save failure | Save throws error | dirty=true, error toast |

### 3.5 Agent Card

| Scenario | Props | Expected |
|----------|-------|----------|
| Selected card | `isSelected=true` | Highlighted/amber border |
| Non-selected card | `isSelected=false` | Default surface background |
| Running agent | `status="running"` | Amber pulse dot + job title |
| Disabled agent | `enabled=false` | Grayed out, strikethrough name |
| Card click | Click handler called | `onClick` fires with agent name |

### 3.6 Last Run Info Formatting

| Scenario | Input | Expected |
|----------|-------|----------|
| Just finished | 30s ago | "30s ago" |
| Minutes ago | 5m ago | "5m ago" |
| Hours ago | 3h ago | "3h ago" |
| Days ago | 2d ago | "2d ago" |
| Still running | null completed_at | "Running..." |

### 3.7 All-Agents-Disabled Warning

| Scenario | State | Expected |
|----------|-------|----------|
| All 8 enabled | `[true, true, ...]` | No warning |
| 7 enabled, 1 disabled | `[true, true, ..., false]` | No warning |
| All 8 disabled | `[false, false, ...]` | Warning banner visible |

---

## Layer 4: Integration Tests (Vitest + Mocked Supabase)

### 4.1 API: GET /api/agents

| Scenario | Mock Data | Expected Response |
|----------|-----------|-------------------|
| All agents exist | 8 configs, 0 running jobs | `agents.length === 8`, `runningJobs.length === 0` |
| Some agents running | 8 configs, 2 running jobs | `runningJobs[0].agentName === "backend-dev"` |
| Empty DB | 0 configs | `agents.length === 0` |
| Malformed DB data | Missing fields | Zod rejects or API handles gracefully |
| Response shape | Full valid data | Matches `{ agents: AgentConfig[], runningJobs: RunningJobInfo[] }` |
| Ordering | Agents with order 8, 1, 5, 3 | Returns sorted [1, 3, 5, 8] |

### 4.2 API: PUT /api/agents/[name]

| Scenario | Body | Expected |
|----------|------|----------|
| Update display name | `{ displayName: "New Name" }` | 200, updated field reflected |
| Update model | `{ model: "claude-opus-4-5" }` | 200, model updated |
| Update system prompt | `{ systemPrompt: "new prompt" }` | 200, prompt updated |
| Invalid agent name | PUT to `/api/agents/nonexistent` | 400 |
| Empty system prompt | `{ systemPrompt: "" }` | 400 validation error |
| Unknown agent in URL | `/api/agents/nonexistent` | 404 (or 400) |
| Partial update | Only `order: 5` | Only order field changed |
| laneOverride invalid | `{ laneOverride: "invalid" }` | 400 |

### 4.3 API: PATCH /api/agents/[name]/toggle

| Scenario | Current State | Expected |
|----------|---------------|----------|
| Enable agent | enabled=false | 200, enabled=true |
| Disable agent | enabled=true (at least 2 enabled total) | 200, enabled=false |
| Disable last enabled agent | enabled=true, only 1 enabled | 400, descriptive error |
| Toggle nonexistent | `/nonexistent/toggle` | 404 |

### 4.4 API: GET /api/agents/providers

| Scenario | Mock Data | Expected |
|----------|-----------|----------|
| All available | 6 models, all `available=true` | 2 providers, 6 total models |
| Some unavailable | 2 models `available=false` | Only 4 returned |
| All unavailable | 6 models, all `available=false` | `providers.length === 0` |
| Grouped structure | Full data | Each provider has name + displayName + models[] |
| Empty DB | 0 models | `providers.length === 0` |

### 4.5 API: Model Existence Validation on Save

| Scenario | Request | Expected |
|----------|---------|----------|
| Save with valid model | Model exists in provider_models | 200 |
| Save with invalid model | Model not in DB | 400 with error message |
| Save with unavailable model | `available=false` in DB | 400 with error message |

---

## Layer 5: Playwright Component Tests (MCP / Component Mode)

Component-level Playwright tests use Playwright's **component testing** mode (or direct DOM mounting via `@playwright/experimental-ct-react`) to test individual UI components in isolation with real browser rendering.

### 5.1 AgentCard Component

| Scenario | Interaction | Assertion |
|----------|-------------|-----------|
| Render all status variants | Mount with `running`, `idle`, `error`, `disabled` | Each shows correct dot color |
| Click card | Click on card | `onClick` spy called |
| Running job link | Running card with jobId | Link points to `/dashboard/jobs/:id` |
| Disabled visual | Disabled=true | CSS class or style indicates disabled |
| Model badge shown | Card with model info | Badge text visible |

### 5.2 ModelSelector Component

| Scenario | Interaction | Assertion |
|----------|-------------|-----------|
| Initial render | Mount with provider=null | Both selects show placeholder |
| Select provider | Choose "claude" from dropdown | Model dropdown populates |
| Cascade filter | Choose "opencode", then "claude" | Model list changes correctly |
| Tier badges visible | Premium model selected | Badge shows "premium" |
| First model auto-select | Change provider | onChange fires with first model |

### 5.3 PromptEditor Component

| Scenario | Interaction | Assertion |
|----------|-------------|-----------|
| Type in editor | Type text | value updates, char count changes |
| Warning threshold | Type < 50 chars | Warning indicator shows |
| Paste long content | Paste 5000 chars | Scroll appears, no overflow |
| Placeholder renders | Mount with placeholder prop | Placeholder text visible |

### 5.4 AgentDetail Panel

| Scenario | Interaction | Assertion |
|----------|-------------|-----------|
| Full render with data | Mount with valid agentConfig | All sections visible |
| Save button state | No changes → make change | Button transitions disabled→enabled |
| Reset reverts | Change field → click reset | Field reverts to original value |
| Toggle switch | Click enabled toggle | Switch state flips |

---

## Layer 6: Playwright E2E Tests (Full Page)

These use the existing `__fixture` pattern from middleware + server components, plus `page.route()` for API interception.

### 6.1 Navigation & Page Render

- Navigate to `/dashboard/agents`
- Verify page title "Agent Management" (or similar) is visible
- Verify sidebar "Agents" nav item is highlighted
- Verify 8 agent cards are displayed
- Verify the correct card layout (2-column: list + detail)
- Verify initial agent counts (total: 8, online: 0 — since no running jobs without mocked data)

### 6.2 Agent Selection & Detail Panel

- Click on agent card index 0 (product-owner)
- Verify detail panel slides in / opens
- Verify agent name is displayed (read-only)
- Verify display name input matches seeded value
- Verify role input matches seeded value
- Verify provider dropdown shows correct provider
- Verify model dropdown shows correct model
- Verify system prompt textarea contains seeded prompt
- Verify enabled switch matches seeded value

### 6.3 Enable/Disable Toggle

- Select an agent
- Click enable/disable switch
- Verify toast/indicator of pending change
- Click Save
- Verify network call to `/api/agents/[name]` or PATCH toggle
- Verify the card status updates (grayed out if disabled)

### 6.4 Last-Agent Disable Guard

- Mock all agents disabled except one
- Attempt to disable the last enabled agent
- Verify 400 error response displayed to user
- Verify switch reverts to enabled state
- Verify warning message visible

### 6.5 Model Change & Save

- Select agent, change provider from "claude" to "opencode"
- Verify model dropdown cascades correctly
- Select the first available model
- Click Save
- Verify PUT request sent with correct payload
- Verify card model badge updates after save
- Verify toast says "Saved" or similar

### 6.6 System Prompt Edit & Save

- Select agent, clear prompt textarea → type new prompt
- Verify character count updates
- Click Save
- Verify network call carries updated systemPrompt
- Verify prompt persists after page reload (via fixture)

### 6.7 Provider/Model Cascade Interaction

- Select an agent currently using "claude/sonnet-4-6"
- Change provider to "opencode"
- Verify model dropdown shows only opencode models
- Verify model auto-selects to first opencode model
- Verify tier badge changes from "premium" to "cheap"
- Change provider back to "claude"
- Verify model dropdown shows only claude models again

### 6.8 Real-Time Status Visual Simulation

- Mock a running job via page.route intercepts
- Navigate to page with mocked data showing agent "backend-dev" is running
- Verify backend-dev card shows amber pulse dot
- Verify status badge says "Running"
- Verify job title link is visible
- Verify detail panel for backend-dev shows "Currently running: Job Title"

### 6.9 Unsaved Changes Warning

- Select agent, modify a field
- Attempt to navigate away (simulate via JavaScript or test routing)
- Verify browser `beforeunload` fires or custom warning appears
- Save changes
- Verify warning no longer appears

### 6.10 Provider Management Page/Sheet

- Navigate to provider management (page or open sheet)
- Verify all providers listed with their models
- Verify model availability toggles work
- Verify add model form validates inputs
- Verify remove model works (with confirmation)

### 6.11 All-Agents-Disabled Warning Banner

- Mock all agents disabled
- Navigate to page
- Verify warning banner at top: "All agents are disabled. Pipeline cannot run."
- Enable one agent
- Verify warning banner disappears

### 6.12 Error State Handling

- Mock API to return 500 on agent list fetch
- Navigate to page
- Verify error state UI is displayed (retry button or error message)
- Mock API to return 500 on save
- Attempt save, verify error toast shown

---

## Layer 7: Worker Integration Tests (Node)

### 7.1 Config Loader with Real DB (Integration)

- Spin up test Supabase instance (or use testcontainers/postgres)
- Run migration
- Seed data
- Load config → verify all 8 agents present
- Update one config in DB → invalidate cache → reload → verify change reflected

### 7.2 Orchestrator with Mock Agents

- Mock agent functions to return immediately
- Test pipeline with all agents enabled → all called in order
- Test pipeline with backend-dev disabled → backend-dev NOT called, others called
- Test pipeline with all agents disabled → pipeline skips all, returns degraded result
- Test `current_agent` updates on jobs table → verify Supabase update called with correct agent name

### 7.3 Router with Lane Override (Node Unit)

- Unit-test `resolveRoute()` with every lane override combination
- Verify cost-limit enforcement still works with lane override
- Verify BASE_POLICY unchanged when no override

---

## Layer 8: Edge Case Matrix

| # | Edge Case | Layer | Expected Outcome |
|---|-----------|-------|------------------|
| 1 | Empty provider_models table | API | Returns empty providers list |
| 2 | Model deleted while agent references it | API + UI | Warning on save, model marked unavailable |
| 3 | All 8 agents disabled mid-pipeline | Worker | Pipeline completes degraded, all skipped |
| 4 | Config change during running job | Worker | Running job unaffected, next job picks up |
| 5 | Concurrent save requests to same agent | API | Second update overwrites (no lock) — acceptable UX |
| 6 | System prompt > 100KB | API + UI | Textarea scrolls, DB accepts TEXT, API returns 200 |
| 7 | Special chars in system prompt (SQL injection attempt) | API | Zod validates as string, Supabase parameterized |
| 8 | Invalid UUID in URL params | API | Zod rejects, returns 400 |
| 9 | Realtime channel drops then reconnects | UI | React re-subscribes, state catches up |
| 10 | Two browser tabs open simultaneously | UI | One tab's save reflected in other via Realtime |
| 11 | `lane_override` set but cost limit exceeded | Worker | Cost check still enforced despite override |
| 12 | Agent name in URL with wrong case | API | Case-sensitive match (AgentName enum) → 400 |

---

## Test Data Strategy

### Fixture Files

Create `apps/dashboard/tests/fixtures/agent-configs.ts`:

```ts
export const ALL_AGENTS = [ /* 8 seeded configs */ ];
export const RUNNING_JOBS = [
  { jobId: "job-1", jobTitle: "Login Ekle", agentName: "backend-dev", startedAt: "...", stepMessage: "..." },
];
export const PROVIDERS = [
  { name: "claude", displayName: "Claude", models: [...] },
  { name: "opencode", displayName: "OpenCode", models: [...] },
];
```

### Mock Supabase Factory

Create `apps/dashboard/tests/utils/mock-supabase.ts`:

```ts
// Returns a mock supabase client with vi.fn() for every method
// Used by both unit tests and E2E fixture interceptors
```

### DB Seeding Script

Create `apps/dashboard/tests/seed-test-db.ts`:

```ts
// Standalone script to seed a test Supabase instance with known data
// Used by integration tests that hit a real DB
```

---

## CI Integration

```yaml
# .github/workflows/test.yml
name: Test Suite
on: [pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm test -- --coverage

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm build
      - run: pnpm exec playwright install chromium
      - run: pnpm test:e2e
```

---

## Test Infrastructure Setup

### Vitest Configuration

Create `apps/dashboard/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",          // API tests
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "app/api/agents/**",
        "lib/supabase/types.ts",
      ],
    },
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

For component tests, add a separate config or use `react` environment:

```ts
// vitest.config.ui.ts
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.ui.test.tsx"],
    setupFiles: ["tests/setup.tsx"],
  },
});
```

### Playwright Component Test Config

```ts
// playwright-ct.config.ts
import { defineConfig, devices } from "@playwright/experimental-ct-react";
export default defineConfig({
  testDir: "./tests/components",
  use: {
    ctPort: 3100,
  },
});
```

---

## Coverage Targets

| Layer | Target |
|-------|--------|
| API Routes (agents/) | 90%+ line, 85%+ branch |
| Core schemas (AgentConfigSchema, etc.) | 100% line |
| agentConfig.ts worker module | 90%+ line |
| Router lane override logic | 100% branch |
| Orchestrator skip logic | 100% branch |
| Agent Card component | 85%+ line |
| Model Selector cascade | 100% branch |
| Agent Detail dirty state | 100% branch |
| All-agents-disabled guard | 100% branch |

---

## Definition of Done (Testing)

- [ ] All unit tests pass (`pnpm test`)
- [ ] All E2E tests pass (`pnpm test:e2e`)
- [ ] Coverage targets met for API + core schemas
- [ ] Every edge case from matrix is tested
- [ ] Tests run in CI on every PR
- [ ] Tests are deterministic (same seed data, no flakiness)
- [ ] No test shares mutable state with another test
- [ ] E2E tests work without any external dependency (fully mocked)
- [ ] Worker tests work without spawning actual agent processes
- [ ] README / docs updated with test commands and patterns
