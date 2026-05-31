# Agent Management Dashboard — E2E & Test Implementation Prompts

Each prompt below is designed to be given to an AI agent (Antigravity / Claude Code) for implementation. Prompts provide full context: files to read, exact scenarios to implement, constraints, and verification steps.

---

## Prompt T-INFRA: Test Infrastructure Setup

```
You are working on the Conductor project — a monorepo with a Next.js 15 dashboard app (apps/dashboard) and a Node.js worker (apps/worker). The project uses Vitest for unit/integration tests and Playwright for E2E.

CONTEXT:
The agent management dashboard project has been fully implemented (DB migration, API routes, UI components, worker integration). Now we need a proper test infrastructure. Currently there is no vitest config, no test setup files, and only one Playwright E2E test.

TASK:
Set up the complete test infrastructure:

1. Create apps/dashboard/vitest.config.ts:
   - globals: true
   - environment: "node" for API tests
   - include: ["tests/**/*.test.ts"]
   - coverage provider: "v8"
   - setupFiles: ["tests/setup.ts"]
   - resolve alias: @ → dashboard root
   - Do NOT use jsdom — API tests are Node-only

2. Create apps/dashboard/vitest.config.ui.ts:
   - environment: "jsdom" 
   - include: ["tests/**/*.ui.test.tsx"]
   - setupFiles: ["tests/setup.tsx"]
   - globals: true
   - resolve alias: @ → dashboard root

3. Create apps/dashboard/tests/setup.ts:
   - Load dotenv from .env.test if exists
   - Set NODE_ENV=test
   - Configure vi.useFakeTimers() for time-dependent tests?

4. Create apps/dashboard/tests/setup.tsx:
   - Import '@testing-library/jest-dom/vitest' for DOM matchers
   - Set up any global React test utilities

5. Create apps/dashboard/tests/fixtures/agent-configs.ts:
   - Export ALL_AGENTS: array of 8 fully populated AgentConfig objects matching seed data
   - Export RUNNING_JOBS: array with 2 running job entries (backend-dev and code-reviewer)
   - Export PROVIDERS: grouped provider list matching seed provider_models
   - Export SINGLE_AGENT: a single agent config for component tests

6. Create apps/dashboard/tests/fixtures/mock-data.ts:
   - Export mockResponse<T>(data): helper to create Supabase-style response { data, error }
   - Export mockErrorResponse<T>(message): helper for error cases

7. Update apps/dashboard/package.json to add test scripts:
   - "test:ui": "vitest run --config vitest.config.ui.ts"
   - "test:watch": "vitest"
   - "test:coverage": "vitest run --coverage"
   - Keep existing "test": "vitest run"

8. Update root package.json if needed (verify "test" script cascades correctly)

CONSTRAINTS:
- Follow the existing project structure
- Use Vitest 2.x APIs (vi.mock, vi.fn, vi.spyOn)
- No external test libraries beyond what's already in package.json
- The fixtures should match the exact shape of the Zod schemas in @conductor/core
- TypeScript strict mode

FILES TO READ:
- apps/dashboard/package.json (current test scripts, dependencies)
- packages/core/src/types.ts (AgentConfig, ProviderModel shapes)
- apps/dashboard/lib/supabase/types.ts (Database row types)
- apps/dashboard/playwright.config.ts (existing E2E config)
- apps/dashboard/e2e/waiting-input.spec.ts (existing E2E patterns)

OUTPUT:
Create all infrastructure files. Do NOT run tests yet — they will be written in subsequent prompts.
```

---

## Prompt T-DB: Database & Migration Tests

```
You are working on the Conductor project. The agent management feature has been implemented. We need database-level verification tests.

CONTEXT:
The 005_agent_management.sql migration has been applied. We need programmatic verification that the migration is correct — table structure, constraints, triggers, RLS, and seed data.

TASK:
Create apps/dashboard/tests/db/migration-005.test.ts.

The test file should verify:

=== Structure Tests ===

1. "agent_config table exists with correct columns" — verify column names, types, nullability, defaults for:
   - id (uuid, PK, not null)
   - agent_name (text, unique, not null)
   - display_name (text, not null)
   - role (text, not null)
   - provider (text, not null, default 'claude')
   - model (text, not null, default 'claude-sonnet-4-6')
   - system_prompt (text, not null)
   - skill_path (text, nullable)
   - enabled (boolean, not null, default true)
   - lane_override (text, nullable)
   - order (int, not null, default 0)
   - created_at (timestamptz, default now())
   - updated_at (timestamptz, default now())

2. "provider_models table exists with correct columns":
   - id (uuid, PK)
   - provider (text, not null)
   - model_id (text, not null)
   - display_name (text, not null)
   - capabilities (jsonb, default '{}')
   - available (boolean, default true)
   - created_at (timestamptz, default now())
   - UNIQUE(provider, model_id)

3. "jobs table has new columns":
   - current_agent (text, nullable)
   - current_step_message (text, nullable)

=== Constraint Tests (via DB queries if available, or descriptive assertions) ===

4. "agent_name CHECK constraint allows all 8 valid names"
5. "agent_name CHECK constraint rejects invalid name"
6. "provider_models UNIQUE(provider, model_id) constraint works"
7. "updated_at trigger updates on row modification"

=== Seed Data Tests ===

8. "provider_models has exactly 6 seed rows"
9. "agent_config has exactly 8 seed rows"
10. "Each agent_config has correct order values 1-8"
11. "agent_config.system_prompt is non-empty for every agent"

=== RLS Tests (descriptive / can be skipped if no real DB) ===

12. "RLS is enabled on agent_config"
13. "RLS is enabled on provider_models"
14. "service_role policy exists on both tables"

NOTE: These tests are designed to run against a real Supabase instance (CI with a test project). If no DB is available, the tests should be structured so they are skipped when SUPABASE_URL is not set, using a conditional describe block.

CONSTRAINTS:
- Each test should be self-contained and descriptive
- Use helper functions to query DB schema
- Skip tests gracefully when no DB connection is available
- Follow the existing test patterns

FILES TO READ:
- apps/dashboard/supabase/migrations/005_agent_management.sql
- apps/dashboard/lib/supabase/server.ts
- apps/dashboard/lib/supabase/types.ts
- packages/core/src/types.ts

OUTPUT:
Create the test file. It should compile with `pnpm typecheck`.
```

---

## Prompt T-BE-UNIT: Backend Unit Tests — Core Schemas & Worker Modules

```
You are working on the Conductor project. We need unit tests for the backend code: Zod schemas in @conductor/core and worker modules.

CONTEXT:
The core types (AgentConfigSchema, ProviderModelSchema, updated JobSchema) and worker modules (agentConfig.ts, router.ts, orchestrator.ts, processJob.ts) have been implemented. They need unit test coverage.

TASK:
Create the following test files:

=== 1. packages/core/src/__tests__/types.test.ts ===

Test all Zod schemas:

AgentConfigSchema:
- Valid full object parses successfully
- agentName validation: valid enum values ("product-owner", "codebase-analyst", "tech-lead", "backend-dev", "frontend-dev", "security-reviewer", "code-reviewer", "qa-engineer")
- agentName validation: invalid values rejected
- laneOverride: "cheap", "premium", null accepted
- laneOverride: "ultra-cheap" rejected
- enabled: must be boolean
- order: must be integer >= 0
- systemPrompt: must be string (empty allowed — validated at API layer)
- skillPath: null accepted, string accepted
- Partial object with only required fields

ProviderModelSchema:
- Valid full object parses
- capabilities defaults to '{}' when omitted
- available defaults to true when omitted
- UNIQUE(provider, model_id) — this is DB-only, test the TypeScript type compiles

JobSchema update:
- currentAgent: null accepted, string accepted
- currentStepMessage: null accepted, string accepted
- Existing JobSchema fields still work unchanged

JobRowSchema update:
- current_agent: null accepted, string accepted
- current_step_message: null accepted, string accepted

=== 2. apps/worker/src/__tests__/agentConfig.test.ts ===

Test the config loader module. Use vi.mock for supabase:

- loadAgentConfig: returns Map with 8 entries when supabase returns 8 rows
- loadAgentConfig: returns empty Map when supabase returns 0 rows
- loadAgentConfig: returns empty Map when supabase throws (graceful error handling)
- getAgentConfig: returns correct AgentConfig for known agent name
- getAgentConfig: returns null for unknown agent name
- getAgentConfig: returns null when cache is empty (before load)
- invalidateConfigCache: clears the cache
- After invalidate + reload, getAgentConfig returns fresh data
- Concurrent access: calling getAgentConfig during loadAgentConfig doesn't crash

=== 3. apps/worker/src/__tests__/router.test.ts ===

Test resolveRoute with laneOverride:

- resolveRoute with no laneOverride: follows BASE_POLICY (use existing logic)
- resolveRoute with laneOverride="cheap": always returns cheap lane
- resolveRoute with laneOverride="premium": always returns premium lane
- resolveRoute with undefined agentConfig: pure BASE_POLICY path (backward compat)
- resolveRoute with laneOverride + cost limit exceeded: cost limit still enforced

=== 4. apps/worker/src/__tests__/orchestrator.test.ts ===

Test pipeline skip logic. Use vi.mock for agent functions:

- All agents enabled: all 8 agent functions called in order
- backend-dev disabled: backend-dev skipped with warning log, other 7 called
- product-owner disabled: uses description as spec, logs warning
- All agents disabled: pipeline completes degraded, all skipped
- current_agent updated before each agent step
- current_agent cleared in finally block (test success and error paths)
- current_step_message updated with agent step info
- Disabled agent fallback for each type (verify the fallback behavior)

=== 5. apps/worker/src/__tests__/processJob.test.ts ===

- invalidateConfigCache called at start of processJob
- current_agent and current_step_message cleared in finally block
- Pipeline still runs when cache invalidation succeeds

CONSTRAINTS:
- Use vi.mock for all external dependencies (supabase, agent modules, logger)
- Each test file should be self-contained
- Use describe/it/expect pattern
- Mock at module level (vi.mock) not in individual tests where possible
- Follow TypeScript strict mode
- Tests must be deterministic — no real I/O

FILES TO READ:
- packages/core/src/types.ts (schemas to test)
- apps/worker/src/agentConfig.ts (module to test)
- apps/worker/src/router.ts (module to test)
- apps/worker/src/orchestrator.ts (module to test)
- apps/worker/src/processJob.ts (module to test)
- apps/worker/src/agents/ (each agent file for fallback logic)

OUTPUT:
Create all 5 test files. They should compile with `pnpm typecheck` and pass with `pnpm test`.
```

---

## Prompt T-FE-UNIT: Frontend Unit Tests — Components

```
You are working on the Conductor project. We need unit tests for the frontend UI components of the agents dashboard.

CONTEXT:
The agents dashboard has several React components: AgentCard, AgentDetail, ModelSelector, PromptEditor, AgentStatusBadge. These need unit test coverage for rendering logic, state management, and user interactions.

TASK:
Create the following test files under apps/dashboard/tests/components/:

=== 1. agent-status-badge.ui.test.tsx ===

import { render, screen } from the appropriate test utils.
Use vitest config for environment: jsdom.

Tests:
- Renders amber dot with pulse class when status="running"
- Renders green dot without animation when status="idle"
- Renders red dot when status="error"
- Renders gray dot with dashed indicator when status="disabled"
- Displays status text label ("Running", "Idle", "Error", "Disabled")
- When running with jobTitle and jobUrl, renders a link
- When running without jobTitle, renders text only (no link)
- When idle, does not render link even if jobTitle provided

=== 2. model-selector.ui.test.tsx ===

- Renders provider and model dropdowns
- Provider dropdown shows all provider names
- Changing provider updates model dropdown options
- Model dropdown shows "Loading..." or empty when no models for provider
- Selecting a model fires onChange with correct provider + model
- Tier badge rendered next to each model option
- First model auto-selected when provider changes
- Model dropdown is disabled when no models available

=== 3. prompt-editor.ui.test.tsx ===

- Renders textarea with correct initial value
- Typing updates the value (simulate onChange)
- Character count displays correct number
- Warning icon shown when text < 50 characters
- Warning icon hidden when text >= 50 characters
- Placeholder text visible when value is empty
- Textarea has monospace font class
- onChange fires with new value on each keystroke

=== 4. agent-card.ui.test.tsx ===

- Displays agent display name
- Displays model badge
- Clicking card fires onClick handler
- Selected card has visual highlight (check for CSS class or style)
- Running card shows pulsing amber dot
- Running card shows job title
- Disabled card has muted/grayed appearance
- Running card's job title is a clickable link

=== 5. agent-detail.ui.test.tsx ===

- Renders all sections: Identity, Model, Prompt, Skill, Toggle
- Save button is disabled when no changes made
- Save button is enabled after editing a field
- Changing display name → dirty state becomes true
- Reset button reverts all fields to original values
- Toggle switch changes enabled state
- Current run info section shows running job when agent is active
- Current run info section shows "Idle" when agent is not running
- Last run info shows formatted time

CONSTRAINTS:
- Use @testing-library/react for rendering utilities
- Use vi.fn() for callback spies
- Do NOT test the actual API calls — only component rendering and state
- Mock any external dependencies (supabase client, next/navigation)
- Use the fixtures from tests/fixtures/agent-configs.ts for test data
- Style assertions should be minimal (class names, not computed styles)
- Each component test file must be importable with vitest config.ui.ts

FILES TO READ:
- apps/dashboard/app/dashboard/agents/components/agent-status-badge.tsx
- apps/dashboard/app/dashboard/agents/components/model-selector.tsx
- apps/dashboard/app/dashboard/agents/components/prompt-editor.tsx
- apps/dashboard/app/dashboard/agents/components/agent-card.tsx
- apps/dashboard/app/dashboard/agents/components/agent-detail.tsx
- apps/dashboard/tests/fixtures/agent-configs.ts (test data)
- packages/core/src/types.ts (types)

OUTPUT:
Create all 5 test files under apps/dashboard/tests/components/.
```

---

## Prompt T-API-INTEGRATION: API Integration Tests

```
You are working on the Conductor project. We need integration tests for the 4 agent-related API endpoints.

CONTEXT:
The API routes (GET /api/agents, PUT /api/agents/[name], PATCH toggle, GET /api/agents/providers) have been implemented. They use the server-side Supabase client. We need to test them with mocked Supabase responses.

TASK:
Create apps/dashboard/tests/api/agents-api.test.ts.

Use vi.mock to mock the Supabase server client. The tests should verify request handling, validation, response shape, and error conditions.

=== GET /api/agents ===

Test "returns all agents and running jobs":
- Mock supabase to return 8 agent configs and 2 running jobs
- Call GET /api/agents
- Assert response status 200
- Assert response.agents has length 8
- Assert response.runningJobs has length 2
- Assert response shape matches { agents: [...], runningJobs: [...] }

Test "returns empty arrays when no data":
- Mock supabase to return 0 configs, 0 running jobs
- Assert agents=[] and runningJobs=[]

Test "agents are ordered by order field":
- Mock supabase to return configs in scrambled order
- Assert response.agents are sorted by order ASC

Test "handles supabase error gracefully":
- Mock supabase to throw
- Assert response status 500 with error message

=== PUT /api/agents/[name] ===

Test "updates display name":
- Mock supabase to perform update successfully
- Send PUT with { displayName: "New Name" }
- Assert 200, updated config returned

Test "rejects invalid agent name":
- Send PUT to /api/agents/nonexistent
- Assert 400

Test "rejects empty system prompt":
- Send PUT with { systemPrompt: "" }
- Assert 400

Test "rejects invalid laneOverride":
- Send PUT with { laneOverride: "invalid" }
- Assert 400

Test "rejects non-existent model":
- Mock supabase to return empty for provider_models lookup
- Send PUT with { model: "fake-model" }
- Assert 400

Test "partial update only changes specified fields":
- Initial config has displayName="Old", role="Old Role"
- Send PUT with { displayName: "New" }
- Assert displayName changed, role unchanged

=== PATCH /api/agents/[name]/toggle ===

Test "enables a disabled agent":
- Mock current state: enabled=false
- Send PATCH toggle
- Assert 200, enabled=true

Test "disables an enabled agent (not the last one)":
- Mock current state: enabled=true, total enabled count > 1
- Assert 200, enabled=false

Test "rejects disabling the last enabled agent":
- Mock current state: enabled=true, only 1 agent enabled total
- Assert 400 with descriptive error
- Assert enabled remains true (or no change)

Test "returns 404 for nonexistent agent":
- Send PATCH to /api/agents/nonexistent/toggle
- Assert 404

=== GET /api/agents/providers ===

Test "returns providers grouped correctly":
- Mock 6 models from 2 providers
- Assert response has 2 providers
- Assert claude has 4 models, opencode has 2
- Assert each model has displayName and capabilities

Test "filters unavailable models":
- Mock 2 models with available=false
- Assert those models are not in the response

Test "returns empty when no providers":
- Mock 0 models
- Assert providers is empty array

CONSTRAINTS:
- Mock Supabase at the module level using vi.mock("../../lib/supabase/server")
- Each test should create fresh mocks
- Use the fixtures from tests/fixtures/ for test data
- Test route handlers directly by importing them (not through HTTP)
- For Next.js route handler testing, create a helper to construct Request objects

HINT FOR TESTING NEXT.JS ROUTE HANDLERS:
```ts
// Route handlers export GET/PUT/PATCH as functions:
// export async function GET(request: NextRequest) { ... }
// They can be called directly:
const response = await GET(new Request("http://localhost:3000/api/agents"));
const body = await response.json();
```

FILES TO READ:
- apps/dashboard/app/api/agents/route.ts
- apps/dashboard/app/api/agents/[name]/route.ts
- apps/dashboard/app/api/agents/providers/route.ts
- apps/dashboard/lib/supabase/server.ts
- apps/dashboard/tests/fixtures/agent-configs.ts
- packages/core/src/types.ts

OUTPUT:
Create the test file with all test cases. Should pass with `pnpm test`.
```

---

## Prompt T-E2E: Playwright E2E Tests — Full Page

```
You are working on the Conductor project. We need comprehensive Playwright E2E tests for the agents management dashboard.

CONTEXT:
The agents dashboard is live at /dashboard/agents. It includes a 2-column layout with agent cards on the left and a detail panel on the right. The page uses Realtime subscriptions and fetches data from Supabase. We already have an existing E2E pattern in apps/dashboard/e2e/waiting-input.spec.ts that uses page.route() interception and the __fixture query param pattern.

TASK:
Create apps/dashboard/e2e/agents-dashboard.spec.ts with the following test scenarios.

NOTE: This is the most important test file. It must be thorough, robust, and cover every interaction a real user would perform.

=== Fixture Setup ===

Create a helper at the top or in a separate file tests/e2e-helpers.ts:

```ts
import { Page } from "@playwright/test";

// Fixture data matching seeded DB values
export const AGENTS_FIXTURE = [
  { agent_name: "product-owner", display_name: "Product Owner", provider: "claude", model: "claude-sonnet-4-6", order: 1, enabled: true, role: "Product Owner & Requirements Analyst", system_prompt: "You are the Product Owner agent..." },
  // ... all 8 agents
];

export async function mockAgentsPage(page: Page, overrides?: {
  agents?: typeof AGENTS_FIXTURE;
  runningJobs?: RunningJobInfo[];
  providers?: ProviderGroup[];
}) {
  // Intercept ALL Supabase REST calls and Realtime
  // Return fixture data based on overrides (or defaults)
  await page.route("**/rest/v1/agent_config*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(overrides?.agents ?? AGENTS_FIXTURE) });
  });
  await page.route("**/rest/v1/provider_models*", async (route) => {
    await route.fulfill({ status: 200, ... });
  });
  await page.route("**/rest/v1/jobs?current_agent=neq.null*", async (route) => {
    await route.fulfill({ status: 200, ... });
  });
  await page.route("**/realtime/**", async (route) => route.abort());
}
```

=== Test Scenarios ===

1. "renders all 8 agent cards"
   - Navigate to /dashboard/agents
   - Verify page title is visible
   - Verify 8 agent cards are displayed (by locator count)
   - Verify agent names are visible: "Product Owner", "Tech Lead", "Backend Dev", etc.

2. "selecting an agent opens detail panel"
   - Click on the first agent card ("Product Owner")
   - Verify detail panel is visible
   - Verify detail panel shows agent name (read-only field)
   - Verify detail panel shows display name input
   - Verify detail panel shows the enable/disable switch

3. "disabling an agent shows disabled state"
   - Select an agent
   - Click the enable/disable switch (to disable)
   - Click Save
   - Wait for success toast/indicator
   - Verify the agent card is visually disabled (grayed out, strikethrough)
   - Re-enable the agent

4. "cannot disable the last enabled agent"
   - Mock the API to simulate only 1 agent enabled
   - Attempt to disable that agent
   - Verify error message is displayed
   - Verify switch reverts to enabled position

5. "changing provider cascades model dropdown"
   - Select an agent using "claude" provider
   - Click the provider dropdown
   - Select "opencode"
   - Verify model dropdown now shows only opencode models
   - Verify a model is auto-selected
   - Verify tier badge shows "cheap" (since opencode models are cheap tier)

6. "editing and saving system prompt"
   - Select an agent
   - Clear the system prompt textarea
   - Type a new prompt: "You are a test agent for E2E testing."
   - Click Save
   - Verify the PUT request to /api/agents/[name] has the correct body
   - Verify success toast appears

7. "model change persists after save and page reload"
   - Select agent, change model, save
   - Reload the page (with fixture data reflecting the change)
   - Verify the model badge on the card reflects the new model

8. "running agent shows real-time status"
   - Mock a running job where "backend-dev" is currently processing
   - Navigate to page
   - Verify backend-dev card shows amber pulse dot
   - Verify status badge shows "Running"
   - Verify detail panel for backend-dev shows currently running job info

9. "unsaved changes warning"
   - Select agent
   - Modify a field (display name)
   - Attempt to trigger navigation (via JavaScript window.location or route change)
   - Verify beforeunload event fires (Playwright: page.on("dialog") to capture)
   - Alternatively: verify UI shows "Unsaved changes" indicator

10. "error state for API failure"
    - Mock agent_config API to return 500
    - Navigate to page
    - Verify error state is displayed (error message, retry button, or fallback UI)

11. "all agents disabled warning"
    - Mock all agents with enabled=false
    - Navigate to page
    - Verify warning banner at top: "All agents are disabled" or similar
    - Verify pipeline status shows "Cannot run"

12. "provider management shows all providers"
    - Navigate to the provider management section (page or sheet)
    - Verify all providers listed with their models
    - Verify models show availability status

=== Custom Matchers & Helpers ===

Create these helpers at the top of the spec file:

- mockAgentsApi(page, fixtures): intercept all Supabase REST calls for the agents page
- mockToggleResponse(page, agentName, newState): mock the PATCH toggle response
- mockSaveResponse(page, agentName, updatedConfig): mock the PUT response
- verifyToast(page, message): wait for and verify a toast notification
- getAgentCard(page, agentName): locate a specific agent card by name
- getDetailField(page, label): locate a specific form field in the detail panel by its label

CONSTRAINTS:
- All tests must be fully self-contained — no shared mutable state
- Use page.route() to mock ALL external API calls (Supabase REST + Realtime)
- Do NOT use __fixture query param (these tests are full-page, not server-component tests)
- Tests must pass in both headed and headless mode
- Use Playwright's built-in assertions (toHaveText, toBeVisible, toHaveCount, etc.)
- Set reasonable timeouts (8-10s default, overridable per assertion)
- Use test.describe to group logically related tests
- Follow the existing e2e test patterns from waiting-input.spec.ts

FILES TO READ:
- apps/dashboard/e2e/waiting-input.spec.ts (existing E2E pattern)
- apps/dashboard/app/dashboard/agents/page.tsx (server page)
- apps/dashboard/app/dashboard/agents/agents-client.tsx (client component)
- apps/dashboard/playwright.config.ts (config)
- apps/dashboard/tests/fixtures/agent-configs.ts (fixture data)

OUTPUT:
Create apps/dashboard/e2e/agents-dashboard.spec.ts with all test scenarios and helpers.
```

---

## Prompt T-CT: Playwright Component Tests

```
You are working on the Conductor project. We need Playwright Component Tests (MCP-style) that test individual UI components in real browser rendering, not just in jsdom.

CONTEXT:
Playwright Component Testing (experimental) allows mounting individual React components in a real Chromium browser and testing interactions. This catches CSS, layout, and browser-specific issues that jsdom-based tests miss. The agent management dashboard has 5 key components to test.

TASK:
Create component-level Playwright tests.

=== Setup: playwright-ct.config.ts ===

Create apps/dashboard/playwright-ct.config.ts:

```ts
import { defineConfig, devices } from "@playwright/experimental-ct-react";
export default defineConfig({
  testDir: "./tests/components-e2e",
  use: {
    ctPort: 3100,
    ctViteConfig: {
      resolve: {
        alias: { "@": __dirname },
      },
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

Add to package.json: "test:ct": "playwright test --config playwright-ct.config.ts"

=== Component Tests ===

Create apps/dashboard/tests/components-e2e/AgentCard.ct.tsx:

1. "renders running state with pulse animation"
   - Mount <AgentCard ... status="running" />
   - Assert the amber dot element has the pulse animation CSS class
   - Assert the running indicator text is visible

2. "clicking card fires onClick"
   - Mount with spy
   - Click the card
   - Assert spy was called with agent name

3. "disabled card has muted styling"
   - Mount with enabled=false
   - Assert CSS class or computed style indicates disabled state

Create apps/dashboard/tests/components-e2e/ModelSelector.ct.tsx:

4. "provider cascade updates model list"
   - Mount with initial provider="claude", model="claude-sonnet-4-6"
   - Change provider to "opencode"
   - Assert model dropdown now shows opencode models
   - Assert selected model is now the first opencode model

5. "tier badge shows correct tier"
   - Mount with premium model
   - Assert "premium" badge is visible
   - Change to cheap model
   - Assert "cheap" badge is visible

Create apps/dashboard/tests/components-e2e/PromptEditor.ct.tsx:

6. "short prompt shows warning"
   - Type 3 characters
   - Assert warning message is visible

7. "long prompt hides warning"
   - Type 50+ characters
   - Assert warning message is not visible

Create apps/dashboard/tests/components-e2e/AgentDetail.ct.tsx:

8. "dirty state tracking"
   - Mount with initial data
   - Assert Save button is disabled
   - Change display name input
   - Assert Save button is enabled
   - Click Reset
   - Assert display name reverts to original
   - Assert Save button is disabled again

CONSTRAINTS:
- Each test file is self-contained with its own imports
- Use the `mount` function from @playwright/experimental-ct-react
- Import components from their source files
- Use fixture data from tests/fixtures/agent-configs.ts
- Test must run in real Chromium browser
- CSS assertions should check computed styles where possible

FILES TO READ:
- apps/dashboard/app/dashboard/agents/components/agent-card.tsx
- apps/dashboard/app/dashboard/agents/components/model-selector.tsx
- apps/dashboard/app/dashboard/agents/components/prompt-editor.tsx
- apps/dashboard/app/dashboard/agents/components/agent-detail.tsx
- apps/dashboard/app/dashboard/agents/components/agent-status-badge.tsx
- apps/dashboard/tests/fixtures/agent-configs.ts

OUTPUT:
Create the config file and all component test files.
```

---

## Prompt T-WORKER-INTEGRATION: Worker Integration Tests

```
You are working on the Conductor project. We need integration tests for the worker modules that interact with agent configuration at the pipeline level.

CONTEXT:
The worker's orchestrator, runner, and router now use database-driven agent configuration. We need to test the full flow: config loading → lane resolution → agent execution → pipeline completion.

TASK:
Create apps/worker/src/__tests__/pipeline-integration.test.ts.

=== Setup ===

Use vi.mock for all external dependencies:
- Mock supabase client
- Mock the agent functions (productOwner.run, backend.run, etc.) to return immediately
- Mock the runner to record which agents were called
- Mock the git/commit operations to no-op

=== Helper Functions ===

Create helpers:
- createMockConfig(agentName, overrides): generates a valid AgentConfig
- createPipelineMocks(): sets up all mocks and returns spy objects
- createJobRecord(overrides): generates a valid job record

=== Test Scenarios ===

1. "full pipeline runs all 8 agents in order"
   - Set up all 8 agents enabled
   - Run the pipeline (call orchestrator or processJob)
   - Verify all 8 agent functions were called
   - Verify they were called in order matching agent_config.order

2. "disabled agents are skipped with fallback behavior"
   - Disable backend-dev and frontend-dev
   - Run the pipeline
   - Verify backend-dev was NOT called
   - Verify frontend-dev was NOT called
   - Verify the other 6 agents WERE called
   - Verify warning logs for the 2 skipped agents

3. "disabled product-owner uses description as spec"
   - Disable product-owner
   - Run pipeline with job description = "Test feature"
   - Verify the spec passed to tech-lead contains "Test feature" or equivalent fallback

4. "current_agent is updated during pipeline execution"
   - Run pipeline
   - Verify supabase.from("jobs").update() was called with current_agent before each agent
   - Verify current_agent was cleared in finally block

5. "agent config cache is invalidated before each pipeline run"
   - First run loads configs into cache
   - Simulate a config change between runs (change in mock DB)
   - Second run reflects the change (new config used)

6. "lane override bypasses BASE_POLICY"
   - Set laneOverride="cheap" on a premium agent
   - Run pipeline for that agent
   - Verify the runner was called with cheap model, not premium

7. "all agents disabled completes degraded"
   - Set all 8 agents enabled=false
   - Run pipeline
   - Verify no agent function was called
   - Verify pipeline still completes (returns normally, doesn't throw)
   - Verify log warnings for each disabled agent

8. "error in one agent doesn't stop the pipeline"
   - Make backend-dev throw an error
   - Run pipeline
   - Verify error is caught and logged
   - Verify pipeline continues with the next agent after backend-dev
   - Verify current_agent is still cleared in finally

CONSTRAINTS:
- Do NOT spawn actual subprocesses — mock all agent spawning
- Do NOT connect to real DB — mock Supabase entirely
- Tests should be fast (< 2s each)
- Use describe/it/expect from vitest
- Each test should restore all mocks after completion (vi.restoreAllMocks or vi.clearAllMocks in afterEach)

FILES TO READ:
- apps/worker/src/agentConfig.ts
- apps/worker/src/orchestrator.ts
- apps/worker/src/runner.ts
- apps/worker/src/router.ts
- apps/worker/src/processJob.ts
- apps/worker/src/agents/index.ts
- packages/core/src/types.ts

OUTPUT:
Create apps/worker/src/__tests__/pipeline-integration.test.ts with all test scenarios.
```

---

## Prompt T-EDGE-CASE: Edge Case & Stress Tests

```
You are working on the Conductor project. We need a comprehensive edge case test file that covers all boundary conditions for the agent management system.

CONTEXT:
The system has several guardrails and edge conditions (last-agent guard, model availability, system prompt limits, concurrent access). These need dedicated tests.

TASK:
Create apps/dashboard/tests/edge-cases/agents-edge-cases.test.ts.

=== Scenarios ===

1. "toggle API prevents disabling last enabled agent"
   - Mock DB state: only 1 agent enabled
   - Call PATCH toggle on that agent
   - Assert 400 response
   - Assert error message contains "last enabled agent" or similar
   - Verify the agent remains enabled in the DB (update was NOT called)

2. "toggle API allows disabling when multiple agents enabled"
   - Mock DB state: 3 agents enabled
   - Call PATCH toggle on one
   - Assert 200
   - Assert enabled flips to false

3. "system prompt validation rejects empty or too-short prompts"
   - Call PUT with systemPrompt="" → 400
   - Call PUT with systemPrompt=" " (whitespace only) → 400 or trimmed to empty → 400
   - Call PUT with systemPrompt="A" (1 char) → hmm, check if there's a min length rule
   - Call PUT with systemPrompt="Valid prompt text that is long enough" → 200

4. "model must exist in provider_models table"
   - Mock provider_models doesn't contain the requested model
   - Call PUT with { model: "nonexistent-model" }
   - Assert 400

5. "model must be available (available=true)"
   - Mock provider_models has the model but available=false
   - Call PUT with { model: "unavailable-model" }
   - Assert 400 with error message about model availability

6. "invalid agent_name in URL returns 400"
   - Call PUT /api/agents/this-is-not-a-valid-agent-name
   - Assert 400
   - Assert error mentions valid agent names

7. "Order field validation"
   - Call PUT with { order: -1 } → 400
   - Call PUT with { order: 3.5 } → 400 (must be integer)
   - Call PUT with { order: 1 } → 200

8. "Concurrent save doesn't corrupt data"
   - This is a design note: if there's no optimistic locking, concurrent saves may overwrite
   - Test that the last write wins (acknowledge the design behavior)
   - Verify no crash/throw on concurrent requests

9. "Realtime channel subscription cleanup"
   - Simulate mounting the agents client component
   - Verify supabase.channel() was called 3 times
   - Unmount the component
   - Verify supabase.removeChannel() was called for all 3 channels
   - Cleanup on unmount prevents memory leaks

10. "Provider management API validates input"
    - POST to add model with missing fields → 400
    - POST to add model with duplicate (provider, model_id) → conflict error
    - PATCH to update model with invalid capabilities JSON → 400

CONSTRAINTS:
- Mock all external dependencies
- Test one edge case per test or logical group
- Tests should be independent and idempotent
- Include both positive and negative assertions

FILES TO READ:
- apps/dashboard/app/api/agents/[name]/route.ts
- apps/dashboard/app/api/agents/providers/route.ts
- apps/dashboard/app/dashboard/agents/agents-client.tsx
- apps/dashboard/lib/supabase/client.ts
- apps/worker/src/agentConfig.ts

OUTPUT:
Create apps/dashboard/tests/edge-cases/agents-edge-cases.test.ts.
```

---

## Prompt T-FIXTURE-SERVER: Server Component Fixture for Agents Page

```
You are working on the Conductor project. We need to add the __fixture pattern to the agents dashboard server page, following the existing pattern from the jobs/[id] page.

CONTEXT:
The existing job detail page (apps/dashboard/app/dashboard/jobs/[id]/page.tsx) uses a `__fixture` query param pattern for E2E testing: when NODE_ENV !== "production" and the fixture param is set, it bypasses DB queries and returns hardcoded fixture data. This allows Playwright E2E tests to run without a real database.

The agents dashboard page (apps/dashboard/app/dashboard/agents/page.tsx) currently always hits Supabase. We need to add the same fixture bypass pattern.

TASK:
Update apps/dashboard/app/dashboard/agents/page.tsx to support the __fixture pattern:

1. Add fixture JOB_ID constant at the top (can reuse the existing one or create a new one)

2. Add fixture data arrays:
   - FIXTURE_AGENTS: 8 agent configs matching seed data
   - FIXTURE_PROVIDERS: provider group structure with all 6 models
   - FIXTURE_RUNNING_JOBS: empty array (or 2 jobs for "realtime" fixture variant)

3. Add fixture check at the beginning of the page component:
   ```ts
   const sp = await searchParams;
   const fixture = sp["__fixture"];
   if (process.env["NODE_ENV"] !== "production" && fixture === "agents_default") {
     return <AgentsClient
       initialAgents={FIXTURE_AGENTS}
       initialProviders={FIXTURE_PROVIDERS}
       initialRunningJobs={FIXTURE_RUNNING_JOBS}
     />;
   }
   if (process.env["NODE_ENV"] !== "production" && fixture === "agents_with_running") {
     return <AgentsClient
       initialAgents={FIXTURE_AGENTS}
       initialProviders={FIXTURE_PROVIDERS}
       initialRunningJobs={FIXTURE_RUNNING_JOBS_WITH_RUNNING}
     />;
   }
   if (process.env["NODE_ENV"] !== "production" && fixture === "agents_all_disabled") {
     const disabled = FIXTURE_AGENTS.map(a => ({ ...a, enabled: false }));
     return <AgentsClient
       initialAgents={disabled}
       initialProviders={FIXTURE_PROVIDERS}
       initialRunningJobs={[]}
     />;
   }
   ```

4. Define these fixture constants in a separate file for test reuse:
   Create apps/dashboard/app/dashboard/agents/__fixtures.ts with all fixture exports

5. Verify the middleware.ts already passes __fixture through (it does — the x-fixture header logic is already in place)

CONSTRAINTS:
- The fixture bypass must only activate when NODE_ENV !== "production"
- Fixture data must exactly match the Zod schema shapes
- Follow the exact pattern from apps/dashboard/app/dashboard/jobs/[id]/page.tsx
- Do NOT add any new dependencies

FILES TO READ:
- apps/dashboard/app/dashboard/jobs/[id]/page.tsx (fixture pattern reference)
- apps/dashboard/app/dashboard/agents/page.tsx (current agents page)
- apps/dashboard/app/dashboard/agents/agents-client.tsx (client component)
- apps/dashboard/middleware.ts (fixture auth bypass)
- apps/dashboard/tests/fixtures/agent-configs.ts (reuse fixture data)
- packages/core/src/types.ts (Zod schema shapes)

OUTPUT:
Update the agents page and create the fixtures file. Verify the page still renders normally without __fixture param.
```

---

## Prompt T-E2E-REALTIME: Realtime & WebSocket E2E Tests

```
You are working on the Conductor project. We need specialized E2E tests for the real-time subscription behavior of the agents dashboard.

CONTEXT:
The agents dashboard uses 3 Supabase Realtime channels (agent_config, jobs, runs). In E2E tests, Realtime WebSocket connections are typically aborted. But we need a way to simulate real-time updates arriving and verify the UI updates correctly.

TASK:
Create a specialized E2E test that simulates real-time behavior.

=== Strategy ===

Instead of actual WebSocket connections (which are aborted), simulate Realtime events by:
1. Loading the page with initial fixture data
2. Using page.evaluate() to directly trigger state updates on the React component
3. Or: simulate the same data change that Realtime would deliver by updating mock data and re-rendering

=== Test File: apps/dashboard/e2e/realtime-agents.spec.ts ===

1. "agent config change reflected in real-time"
   - Load page with initial fixture data (all agents idle)
   - Use page.evaluate() to simulate a Realtime UPDATE event on agent_config
   - (Alternatively: update the mock intercept and verify the component re-renders)
   - Verify the UI updates without page reload (e.g., model badge changes, enabled state changes)

2. "job starts processing — agent shows running"
   - Load page with no running jobs
   - Simulate a jobs UPDATE event where current_agent changes from null to "backend-dev"
   - Verify backend-dev card now shows amber pulse dot
   - Verify status badge now shows "Running"
   - Verify detail panel for backend-dev shows running job info

3. "job finishes processing — agent returns to idle"
   - Continue from test 2 state
   - Simulate current_agent changing from "backend-dev" to null
   - Verify backend-dev card returns to green/gray idle state
   - Verify running indicator is gone

4. "multiple real-time updates don't cause render thrash"
   - Send 10 rapid updates to agent config
   - Verify page doesn't crash
   - Verify final state is correct (last update applied)
   - Measure/verify no console errors

=== Implementation Approach ===

Use a combination of:
- Initial page load with __fixture param for baseline state
- page.evaluate() to push updates through the Supabase Realtime channel callbacks
- Or, for a more robust approach, inject a test helper into the window object:

```ts
// In the client component, in development mode:
if (process.env.NODE_ENV !== 'production') {
  (window as any).__simulateRealtimeEvent = (channel: string, event: any) => {
    // Call the channel callback directly
  };
}
```

Then in tests:
```ts
await page.evaluate(() => {
  (window as any).__simulateRealtimeEvent('agent_config', {
    eventType: 'UPDATE',
    new: { agent_name: 'backend-dev', enabled: false },
  });
});
```

CONSTRAINTS:
- Tests must not rely on actual WebSocket connections
- Use page.evaluate() to trigger state changes
- Verify UI updates with Playwright assertions
- Tests should be deterministic (known initial state, known update)
- Log any console errors during test runs

FILES TO READ:
- apps/dashboard/app/dashboard/agents/agents-client.tsx (Realtime subscriptions)
- apps/dashboard/lib/supabase/client.ts (browser client)
- apps/dashboard/e2e/agents-dashboard.spec.ts (sibling E2E file)
- apps/dashboard/app/dashboard/jobs/jobs-client.tsx (Realtime pattern)

OUTPUT:
Create apps/dashboard/e2e/realtime-agents.spec.ts.
```

---

## Prompt T-PERF: Performance & Load Tests

```
You are working on the Conductor project. We need to verify that the agents dashboard performs well under load.

CONTEXT:
The agents dashboard fetches data from Supabase and subscribes to 3 Realtime channels. Under heavy load (many agents, many running jobs), we need to ensure the page loads within acceptable time and doesn't overwhelm the browser.

TASK:
Create apps/dashboard/tests/perf/agents-perf.test.ts.

=== Tests ===

1. "page load time under 3 seconds"
   - Use Playwright to measure navigation time
   - Navigate to /dashboard/agents (with mocked data for 8 agents)
   - Measure time from navigation start to "network idle" / "load" event
   - Assert < 3000ms

2. "1500 agent configs load without crashing"
   - Mock agent_config endpoint to return 1500 agents
   - Navigate to page
   - Verify page renders (scrollbar, some visible agents)
   - Verify no console errors

3. "50 running jobs display correctly"
   - Mock 50 running jobs
   - Navigate to page
   - Verify all 50 are listed or visible in the running jobs section
   - Verify no layout breakage

4. "memory usage after 10 rapid Realtime updates"
   - Load page
   - Use page.evaluate to simulate 10 rapid config updates
   - Measure heap size before and after (via performance.memory API if available)
   - Assert no significant memory leak (> 10MB increase)

5. "re-render count on config update"
   - Load page
   - Perform a single config update via Realtime simulation
   - Assert React doesn't re-render the entire tree (only affected components)

CONSTRAINTS:
- These are informational/flaky tests — use test.skip or conditional execution
- Mark as "performance" group
- Run only in CI on demand, not on every PR
- Use Playwright's performance APIs (performance.timing, performance.memory)

FILES TO READ:
- apps/dashboard/e2e/agents-dashboard.spec.ts
- apps/dashboard/app/dashboard/agents/agents-client.tsx

OUTPUT:
Create apps/dashboard/tests/perf/agents-perf.test.ts with all performance tests.
```

---

## Quick Reference: Test File Index

| # | File | Type | Layer | Prompt |
|---|------|------|-------|--------|
| 1 | `tests/setup.ts` | Infrastructure | Config | T-INFRA |
| 2 | `tests/setup.tsx` | Infrastructure | Config | T-INFRA |
| 3 | `vitest.config.ts` | Infrastructure | Config | T-INFRA |
| 4 | `vitest.config.ui.ts` | Infrastructure | Config | T-INFRA |
| 5 | `tests/fixtures/agent-configs.ts` | Fixtures | Shared | T-INFRA |
| 6 | `tests/fixtures/mock-data.ts` | Fixtures | Shared | T-INFRA |
| 7 | `tests/db/migration-005.test.ts` | Migration | DB | T-DB |
| 8 | `packages/core/src/__tests__/types.test.ts` | Unit | Core | T-BE-UNIT |
| 9 | `apps/worker/src/__tests__/agentConfig.test.ts` | Unit | Worker | T-BE-UNIT |
| 10 | `apps/worker/src/__tests__/router.test.ts` | Unit | Worker | T-BE-UNIT |
| 11 | `apps/worker/src/__tests__/orchestrator.test.ts` | Unit | Worker | T-BE-UNIT |
| 12 | `apps/worker/src/__tests__/processJob.test.ts` | Unit | Worker | T-BE-UNIT |
| 13 | `tests/components/agent-status-badge.ui.test.tsx` | Unit | FE | T-FE-UNIT |
| 14 | `tests/components/model-selector.ui.test.tsx` | Unit | FE | T-FE-UNIT |
| 15 | `tests/components/prompt-editor.ui.test.tsx` | Unit | FE | T-FE-UNIT |
| 16 | `tests/components/agent-card.ui.test.tsx` | Unit | FE | T-FE-UNIT |
| 17 | `tests/components/agent-detail.ui.test.tsx` | Unit | FE | T-FE-UNIT |
| 18 | `tests/api/agents-api.test.ts` | Integration | API | T-API-INTEGRATION |
| 19 | `e2e/agents-dashboard.spec.ts` | E2E | Full Page | T-E2E |
| 20 | `tests/components-e2e/*.ct.tsx` | E2E | Component | T-CT |
| 21 | `apps/worker/src/__tests__/pipeline-integration.test.ts` | Integration | Worker | T-WORKER-INTEGRATION |
| 22 | `tests/edge-cases/agents-edge-cases.test.ts` | Unit | Cross-layer | T-EDGE-CASE |
| 23 | `app/dashboard/agents/__fixtures.ts` | Fixtures | Server | T-FIXTURE-SERVER |
| 24 | `e2e/realtime-agents.spec.ts` | E2E | Real-time | T-E2E-REALTIME |
| 25 | `tests/perf/agents-perf.test.ts` | Perf | Cross-layer | T-PERF |

---

## Execution Order (Recommended)

```
Phase 1: Infrastructure (T-INFRA) → vitest configs, fixtures
Phase 2: Fixture server component (T-FIXTURE-SERVER)
Phase 3: Unit tests (T-BE-UNIT, T-FE-UNIT) — fast, pure logic
Phase 4: Integration tests (T-API-INTEGRATION, T-WORKER-INTEGRATION) — mocked DB
Phase 5: E2E tests (T-E2E, T-E2E-REALTIME) — full browser
Phase 6: Component tests (T-CT) — Playwright component mode
Phase 7: Edge case + Perf (T-EDGE-CASE, T-PERF) — final validation
```
